#!/usr/bin/env python3
"""Estrae positions da Supabase prod come `seed.json` per la sim.

Filtra per `user_id` risolto da email (default: beta-user@example.com).
Scrive ~/.jht-sim-d2/seed.json con tutti i campi raw che `seed_import.py`
si aspetta. Non include i campi di enrichment (role_family, loc_*, work_*,
office_*): quelli verranno popolati dagli analisti nella sim.

Output: array JSON, una entry per posizione.

Usage:
    SUPABASE_URL=https://...supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
    python3 web/scripts/sim/extract-seed-from-supabase.py [--email <e>] [--out <path>] [--status-any]

Default email: beta-user@example.com
Default out:   ~/.jht-sim-d2/seed.json
Default scope: tutte le posizioni dell'utente (--status-any è default per
               permettere alla sim di rifare l'enrichment su tutto il dataset)

Service role necessario perché:
- L'anon key non può leggere `auth.users` (per risolvere email→user_id).
- Senza filtro user_id corretto la query positions ritorna 0 (RLS).
"""
import os
import sys
import json
import argparse
import urllib.parse
import urllib.request


def http_json(method, url, headers, body=None):
    data = None
    h = dict(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def resolve_user_id(base_url, headers, email):
    """Query auth.users via service_role per ottenere user_id."""
    url = f"{base_url}/auth/v1/admin/users?email={urllib.parse.quote(email)}"
    try:
        data = http_json("GET", url, headers)
    except Exception as e:
        print(f"✗ admin users query failed: {e}", file=sys.stderr)
        sys.exit(2)
    users = data.get("users") if isinstance(data, dict) else data
    if not users:
        print(f"✗ no user with email {email}", file=sys.stderr)
        sys.exit(3)
    # Match esatto (admin endpoint può ritornare match parziali)
    for u in users:
        if u.get("email") == email:
            return u["id"]
    print(f"✗ no exact email match for {email}", file=sys.stderr)
    sys.exit(3)


# Campi necessari a seed_import.py — vedi `INSERT INTO positions`.
# Niente enrichment (role_family, loc_*, work_*, office_*, scores, etc.).
SEED_FIELDS = [
    "title", "company", "location", "remote_type",
    "salary_declared_min", "salary_declared_max", "salary_declared_currency",
    "salary_estimated_min", "salary_estimated_max", "salary_estimated_currency",
    "salary_estimated_source",
    "url", "source", "jd_text", "requirements",
    "found_by", "found_at", "deadline",
    "status", "notes",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="beta-user@example.com")
    parser.add_argument(
        "--out",
        default=os.path.expanduser("~/.jht-sim-d2/seed.json"),
    )
    parser.add_argument(
        "--status-any",
        action="store_true",
        default=True,
        help="Include tutti gli status (default). Usa --only-new per filtrare.",
    )
    parser.add_argument(
        "--only-new",
        action="store_true",
        help="Estrae solo le posizioni status=new (vergini).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max righe (default: nessun limite).",
    )
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.", file=sys.stderr)
        sys.exit(2)

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }

    print(f"→ resolving user_id for {args.email}…", file=sys.stderr)
    user_id = resolve_user_id(url, headers, args.email)
    print(f"  user_id = {user_id}", file=sys.stderr)

    # Build query
    select_csv = ",".join(SEED_FIELDS)
    q = f"{url}/rest/v1/positions?select={select_csv}&user_id=eq.{user_id}&order=found_at.desc.nullslast"
    if args.only_new:
        q += "&status=eq.new"
    if args.limit > 0:
        q += f"&limit={args.limit}"

    print(f"→ fetching positions…", file=sys.stderr)
    rows = http_json("GET", q, headers) or []
    print(f"  retrieved {len(rows)} positions", file=sys.stderr)

    # Garantisce che il path output esista
    out_path = args.out
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"  wrote {out_path}", file=sys.stderr)

    # Company 140 stats
    by_status = {}
    for r in rows:
        s = r.get("status") or "(null)"
        by_status[s] = by_status.get(s, 0) + 1
    print(f"\n  status breakdown:", file=sys.stderr)
    for s, n in sorted(by_status.items(), key=lambda x: -x[1]):
        print(f"    {s:20s} {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
