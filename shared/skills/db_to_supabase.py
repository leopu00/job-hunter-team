#!/usr/bin/env python3
"""Sincronizzazione SQLite → Supabase.

Carica i dati dal database SQLite locale (usato dagli agenti) nel database
Supabase PostgreSQL (usato dalla web app). Usa la colonna legacy_id per
mappare gli ID integer di SQLite agli UUID di Supabase.

Uso:
  python3 db_to_supabase.py sync              # sync completo SQLite → Supabase
  python3 db_to_supabase.py sync --dry-run    # mostra cosa sincronizzerebbe
  python3 db_to_supabase.py status            # mostra conteggi SQLite vs Supabase
  python3 db_to_supabase.py sync --table positions  # sync solo una tabella

Variabili d'ambiente richieste:
  SUPABASE_URL               — URL del progetto Supabase
  SUPABASE_SERVICE_ROLE_KEY  — chiave service role (bypassa RLS)

Opzionali:
  JHT_SUPABASE_USER_ID       — UUID dell'utente Supabase a cui associare i dati
                                (se omesso, lo rileva dal primo utente in auth.users)

Ordine sync: companies → positions → scores → applications → position_highlights
"""

import sys
import os
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from _db import get_db, ensure_schema


def load_env():
    """Carica credenziali Supabase da variabili d'ambiente o .env.local."""
    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not sb_url or not sb_key:
        # Cerca .env.local in varie posizioni (worktree, main, root)
        script_dir = os.path.dirname(__file__)
        candidates = [
            os.path.join(script_dir, '..', '..', 'web', '.env.local'),
            os.path.join(script_dir, '..', '..', '..', 'main', 'web', '.env.local'),
            os.path.join(script_dir, '..', '..', '..', 'web', '.env.local'),
        ]
        for env_file in candidates:
            if not os.path.exists(env_file):
                continue
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        if k == "NEXT_PUBLIC_SUPABASE_URL":
                            sb_url = sb_url or v
                        elif k == "SUPABASE_SERVICE_ROLE_KEY":
                            sb_key = sb_key or v
            if sb_url and sb_key:
                break

    if not sb_url or not sb_key:
        print("ERRORE: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY richiesti.")
        print("Configura in .env o web/.env.local")
        sys.exit(1)

    return sb_url, sb_key


# ── Supabase REST API helpers ─────────────────────────────────

def sb_get(url, key, path):
    """GET request a Supabase REST API (usa service role, bypassa RLS)."""
    endpoint = f"{url}/rest/v1/{path}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    req = urllib.request.Request(endpoint, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sb_post(url, key, table, data, upsert_cols=None):
    """POST (insert o upsert) a Supabase REST API."""
    endpoint = f"{url}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if upsert_cols:
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        endpoint += f"?on_conflict={upsert_cols}"

    body = json.dumps(data if isinstance(data, list) else [data]).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        print(f"  ERRORE {e.code}: {err_body[:300]}")
        return None


def sb_patch(url, key, table, filters, data):
    """PATCH request a Supabase REST API."""
    endpoint = f"{url}/rest/v1/{table}?{filters}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="PATCH")
    urllib.request.urlopen(req)


def sb_count(url, key, table):
    """Conta righe in una tabella Supabase."""
    endpoint = f"{url}/rest/v1/{table}?select=count"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "count=exact",
    }
    req = urllib.request.Request(endpoint, headers=headers, method="HEAD")
    with urllib.request.urlopen(req) as resp:
        content_range = resp.headers.get("Content-Range", "")
        if "/" in content_range:
            return int(content_range.split("/")[1])
    # Fallback: GET e conta
    data = sb_get(url, key, f"{table}?select=id&limit=10000")
    return len(data)


def get_user_id(url, key):
    """Ottieni user_id dall'env o dal primo utente Supabase."""
    user_id = os.environ.get("JHT_SUPABASE_USER_ID")
    if user_id:
        return user_id

    # Prova a leggere da candidate_profiles (il primo utente)
    profiles = sb_get(url, key, "candidate_profiles?select=user_id&limit=1")
    if profiles:
        return profiles[0]["user_id"]

    # Fallback: lista utenti via auth admin API
    try:
        endpoint = f"{url}/auth/v1/admin/users?per_page=1"
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }
        req = urllib.request.Request(endpoint, headers=headers)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            users = data.get("users", data) if isinstance(data, dict) else data
            if users:
                return users[0]["id"]
    except Exception:
        pass

    print("ERRORE: impossibile determinare user_id.")
    print("Configura JHT_SUPABASE_USER_ID nel tuo .env")
    sys.exit(1)


# ── Sync logic ────────────────────────────────────────────────

def sync_companies(conn, sb_url, sb_key, user_id, dry_run=False):
    """Sync tabella companies: SQLite → Supabase."""
    rows = conn.execute("SELECT * FROM companies").fetchall()
    if not rows:
        print("  Companies: 0 in SQLite, skip")
        return {}

    # Carica esistenti da Supabase per evitare duplicati
    existing = sb_get(sb_url, sb_key, f"companies?user_id=eq.{user_id}&select=id,name")
    name_to_uuid = {c["name"].lower(): c["id"] for c in existing}

    inserted = 0
    updated = 0
    id_map = {}  # SQLite ID → Supabase UUID

    for r in rows:
        name = r["name"]
        data = {
            "user_id": user_id,
            "name": name,
            "website": r["website"],
            "hq": r["hq_country"],
            "size": r["size"],
            "sector": r["sector"],
            "glassdoor_rating": r["glassdoor_rating"],
            "red_flags": r["red_flags"],
            "culture_notes": r["culture_notes"],
            "analyzed_by": r["analyzed_by"],
            "verdict": r["verdict"],
        }
        if r["analyzed_at"]:
            data["analyzed_at"] = r["analyzed_at"]

        if name.lower() in name_to_uuid:
            uuid = name_to_uuid[name.lower()]
            id_map[r["id"]] = uuid
            if not dry_run:
                sb_patch(sb_url, sb_key, "companies",
                         f"id=eq.{uuid}", data)
            updated += 1
        else:
            if not dry_run:
                result = sb_post(sb_url, sb_key, "companies", data)
                if result:
                    uuid = result[0]["id"]
                    id_map[r["id"]] = uuid
                    name_to_uuid[name.lower()] = uuid
                    inserted += 1
            else:
                inserted += 1

    print(f"  Companies: {inserted} inserite, {updated} aggiornate")
    return id_map


def sync_positions(conn, sb_url, sb_key, user_id, company_map, dry_run=False):
    """Sync tabella positions: SQLite → Supabase."""
    rows = conn.execute("SELECT * FROM positions").fetchall()
    if not rows:
        print("  Positions: 0 in SQLite, skip")
        return {}

    # Carica esistenti da Supabase per legacy_id mapping
    existing = sb_get(sb_url, sb_key,
                      f"positions?user_id=eq.{user_id}&select=id,legacy_id,url")
    legacy_to_uuid = {}
    url_to_uuid = {}
    for p in existing:
        if p.get("legacy_id"):
            legacy_to_uuid[p["legacy_id"]] = p["id"]
        if p.get("url"):
            url_to_uuid[p["url"]] = p["id"]

    inserted = 0
    updated = 0
    id_map = {}  # SQLite ID → Supabase UUID

    for r in rows:
        sqlite_id = r["id"]

        # Cerca score totale per positions.score
        score_row = conn.execute(
            "SELECT total_score FROM scores WHERE position_id = ?",
            (sqlite_id,)
        ).fetchone()
        total_score = score_row["total_score"] if score_row else None

        # Mappa company_id
        sb_company_id = None
        if r["company_id"] and r["company_id"] in company_map:
            sb_company_id = company_map[r["company_id"]]

        data = {
            "user_id": user_id,
            "legacy_id": sqlite_id,
            "title": r["title"],
            "company": r["company"],
            "company_id": sb_company_id,
            "url": r["url"],
            "location": r["location"],
            "remote_type": _normalize_remote(r["remote_type"]),
            "status": _normalize_status(r["status"]),
            "score": total_score,
            "source": r["source"],
            "jd_text": r["jd_text"],
            "requirements": r["requirements"],
            "notes": r["notes"],
            "found_by": r["found_by"],
            "deadline": r["deadline"],
            "salary_declared_min": r["salary_declared_min"],
            "salary_declared_max": r["salary_declared_max"],
            "salary_declared_currency": r["salary_declared_currency"],
            "salary_estimated_min": r["salary_estimated_min"],
            "salary_estimated_max": r["salary_estimated_max"],
            "salary_estimated_source": r["salary_estimated_source"],
        }
        if r["found_at"]:
            data["found_at"] = r["found_at"]
        if r["last_checked"]:
            data["last_checked"] = r["last_checked"]

        # Trova UUID esistente (per legacy_id o URL)
        existing_uuid = legacy_to_uuid.get(sqlite_id)
        if not existing_uuid and r["url"]:
            existing_uuid = url_to_uuid.get(r["url"])

        if existing_uuid:
            id_map[sqlite_id] = existing_uuid
            if not dry_run:
                sb_patch(sb_url, sb_key, "positions",
                         f"id=eq.{existing_uuid}", data)
            updated += 1
        else:
            if not dry_run:
                result = sb_post(sb_url, sb_key, "positions", data)
                if result:
                    uuid = result[0]["id"]
                    id_map[sqlite_id] = uuid
                    inserted += 1
            else:
                inserted += 1

    print(f"  Positions: {inserted} inserite, {updated} aggiornate")
    return id_map


def sync_scores(conn, sb_url, sb_key, user_id, position_map, dry_run=False):
    """Sync tabella scores: SQLite → Supabase."""
    rows = conn.execute("SELECT * FROM scores").fetchall()
    if not rows:
        print("  Scores: 0 in SQLite, skip")
        return

    existing = sb_get(sb_url, sb_key,
                      f"scores?user_id=eq.{user_id}&select=id,position_id")
    pos_to_uuid = {s["position_id"]: s["id"] for s in existing}

    inserted = 0
    updated = 0
    skipped = 0

    for r in rows:
        sb_pos_id = position_map.get(r["position_id"])
        if not sb_pos_id:
            skipped += 1
            continue

        data = {
            "user_id": user_id,
            "position_id": sb_pos_id,
            "total_score": r["total_score"],
            "experience_fit": r["experience_fit"],
            "skill_match": r["stack_match"],
            "location_fit": r["remote_fit"],
            "salary_fit": r["salary_fit"],
            "stack_match": r["stack_match"],
            "remote_fit": r["remote_fit"],
            "strategic_fit": r["strategic_fit"],
            "breakdown": r["breakdown"],
            "notes": r["notes"],
            "scored_by": r["scored_by"],
        }
        if r["scored_at"]:
            data["scored_at"] = r["scored_at"]

        if sb_pos_id in pos_to_uuid:
            score_uuid = pos_to_uuid[sb_pos_id]
            if not dry_run:
                sb_patch(sb_url, sb_key, "scores",
                         f"id=eq.{score_uuid}", data)
            updated += 1
        else:
            if not dry_run:
                result = sb_post(sb_url, sb_key, "scores", data)
                if result:
                    inserted += 1
            else:
                inserted += 1

    print(f"  Scores: {inserted} inseriti, {updated} aggiornati, {skipped} skippati (no position)")


def sync_applications(conn, sb_url, sb_key, user_id, position_map, dry_run=False):
    """Sync tabella applications: SQLite → Supabase."""
    rows = conn.execute("SELECT * FROM applications").fetchall()
    if not rows:
        print("  Applications: 0 in SQLite, skip")
        return

    existing = sb_get(sb_url, sb_key,
                      f"applications?user_id=eq.{user_id}&select=id,position_id")
    pos_to_uuid = {a["position_id"]: a["id"] for a in existing}

    inserted = 0
    updated = 0
    skipped = 0

    for r in rows:
        sb_pos_id = position_map.get(r["position_id"])
        if not sb_pos_id:
            skipped += 1
            continue

        data = {
            "user_id": user_id,
            "position_id": sb_pos_id,
            "cv_path": r["cv_path"],
            "cv_pdf_path": r["cv_pdf_path"],
            "cl_path": r["cl_path"],
            "cl_pdf_path": r["cl_pdf_path"],
            "status": _normalize_app_status(r["status"]),
            "critic_score": r["critic_score"],
            "critic_verdict": _normalize_verdict(r["critic_verdict"]),
            "critic_notes": r["critic_notes"],
            "applied_via": r["applied_via"],
            "written_by": r["written_by"],
            "reviewed_by": r["reviewed_by"],
            "applied": bool(r["applied"]),
            "response": r["response"],
            "cv_drive_id": r["cv_drive_id"],
            "cl_drive_id": r["cl_drive_id"],
        }
        if r["written_at"]:
            data["written_at"] = r["written_at"]
        if r["applied_at"]:
            data["applied_at"] = r["applied_at"]
        if r["response_at"]:
            data["response_at"] = r["response_at"]
        if r["critic_reviewed_at"]:
            data["critic_reviewed_at"] = r["critic_reviewed_at"]

        if sb_pos_id in pos_to_uuid:
            app_uuid = pos_to_uuid[sb_pos_id]
            if not dry_run:
                sb_patch(sb_url, sb_key, "applications",
                         f"id=eq.{app_uuid}", data)
            updated += 1
        else:
            if not dry_run:
                result = sb_post(sb_url, sb_key, "applications", data)
                if result:
                    inserted += 1
            else:
                inserted += 1

    print(f"  Applications: {inserted} inserite, {updated} aggiornate, {skipped} skippate")


def sync_highlights(conn, sb_url, sb_key, user_id, position_map, dry_run=False):
    """Sync tabella position_highlights: SQLite → Supabase."""
    rows = conn.execute("SELECT * FROM position_highlights").fetchall()
    if not rows:
        print("  Highlights: 0 in SQLite, skip")
        return

    # Carica esistenti e cancella/ricrea (highlights non hanno ID stabile)
    inserted = 0
    skipped = 0

    # Raggruppa per position_id
    by_position = {}
    for r in rows:
        sb_pos_id = position_map.get(r["position_id"])
        if not sb_pos_id:
            skipped += 1
            continue
        by_position.setdefault(sb_pos_id, []).append({
            "user_id": user_id,
            "position_id": sb_pos_id,
            "type": r["type"],
            "text": r["text"],
        })

    for sb_pos_id, highlights in by_position.items():
        if dry_run:
            inserted += len(highlights)
            continue

        # Cancella highlights esistenti per questa position
        try:
            endpoint = f"{sb_url}/rest/v1/position_highlights?position_id=eq.{sb_pos_id}"
            headers = {
                "apikey": sb_key,
                "Authorization": f"Bearer {sb_key}",
            }
            req = urllib.request.Request(endpoint, headers=headers, method="DELETE")
            urllib.request.urlopen(req)
        except urllib.error.HTTPError:
            pass

        # Inserisci nuovi
        result = sb_post(sb_url, sb_key, "position_highlights", highlights)
        if result:
            inserted += len(highlights)

    print(f"  Highlights: {inserted} inseriti, {skipped} skippati")


# ── Normalizzazione valori ────────────────────────────────────

def _normalize_remote(val):
    """Normalizza remote_type per CHECK constraint Supabase."""
    if not val:
        return None
    val = val.lower().strip()
    mapping = {
        "remote": "full_remote",
        "full_remote": "full_remote",
        "full-remote": "full_remote",
        "hybrid": "hybrid",
        "onsite": "onsite",
        "on-site": "onsite",
        "on_site": "onsite",
    }
    return mapping.get(val)


def _normalize_status(val):
    """Normalizza status posizione per CHECK constraint Supabase."""
    if not val:
        return "new"
    val = val.lower().strip()
    valid = {"new", "checked", "excluded", "scored", "writing",
             "review", "ready", "applied", "response"}
    return val if val in valid else "new"


def _normalize_app_status(val):
    """Normalizza status application per CHECK constraint Supabase."""
    if not val:
        return "draft"
    val = val.lower().strip()
    valid = {"draft", "review", "approved", "applied", "response"}
    return val if val in valid else "draft"


def _normalize_verdict(val):
    """Normalizza critic_verdict per CHECK constraint Supabase."""
    if not val:
        return None
    val = val.upper().strip()
    valid = {"PASS", "NEEDS_WORK", "REJECT"}
    return val if val in valid else None


# ── Comandi ───────────────────────────────────────────────────

def cmd_sync(dry_run=False, table_filter=None):
    """Sync completo SQLite → Supabase."""
    sb_url, sb_key = load_env()
    user_id = get_user_id(sb_url, sb_key)

    print(f"User ID: {user_id[:8]}...")
    print(f"Dry run: {dry_run}")
    print()

    conn = get_db()
    ensure_schema(conn)

    tables = ["companies", "positions", "scores", "applications", "highlights"]
    if table_filter:
        tables = [t for t in tables if t == table_filter]

    company_map = {}
    position_map = {}

    if "companies" in tables:
        print("Sync companies...")
        company_map = sync_companies(conn, sb_url, sb_key, user_id, dry_run)
    else:
        # Carica mappa esistente
        existing = sb_get(sb_url, sb_key,
                          f"companies?user_id=eq.{user_id}&select=id,name")
        rows = conn.execute("SELECT id, name FROM companies").fetchall()
        name_to_sqlite = {r["name"].lower(): r["id"] for r in rows}
        for c in existing:
            sqlite_id = name_to_sqlite.get(c["name"].lower())
            if sqlite_id:
                company_map[sqlite_id] = c["id"]

    if "positions" in tables:
        print("Sync positions...")
        position_map = sync_positions(conn, sb_url, sb_key, user_id,
                                       company_map, dry_run)
    else:
        # Carica mappa esistente
        existing = sb_get(sb_url, sb_key,
                          f"positions?user_id=eq.{user_id}&select=id,legacy_id")
        for p in existing:
            if p.get("legacy_id"):
                position_map[p["legacy_id"]] = p["id"]

    if "scores" in tables:
        print("Sync scores...")
        sync_scores(conn, sb_url, sb_key, user_id, position_map, dry_run)

    if "applications" in tables:
        print("Sync applications...")
        sync_applications(conn, sb_url, sb_key, user_id, position_map, dry_run)

    if "highlights" in tables:
        print("Sync highlights...")
        sync_highlights(conn, sb_url, sb_key, user_id, position_map, dry_run)

    conn.close()
    print("\nSync completato.")


def cmd_status():
    """Mostra conteggi SQLite vs Supabase."""
    sb_url, sb_key = load_env()
    user_id = get_user_id(sb_url, sb_key)

    conn = get_db()
    ensure_schema(conn)

    tables = ["companies", "positions", "scores", "applications", "position_highlights"]
    print(f"{'Tabella':<25} {'SQLite':>8} {'Supabase':>10}")
    print("-" * 45)

    for table in tables:
        sqlite_count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        sb_count_val = sb_count(sb_url, sb_key, table)
        marker = " <--" if sqlite_count != sb_count_val else ""
        print(f"  {table:<23} {sqlite_count:>8} {sb_count_val:>10}{marker}")

    conn.close()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "sync":
        dry_run = "--dry-run" in sys.argv
        table_filter = None
        if "--table" in sys.argv:
            idx = sys.argv.index("--table")
            if idx + 1 < len(sys.argv):
                table_filter = sys.argv[idx + 1]
        cmd_sync(dry_run, table_filter)
    elif cmd == "status":
        cmd_status()
    else:
        print(f"Comando sconosciuto: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
