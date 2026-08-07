#!/usr/bin/env python3
"""doctor_analytics.py — metriche per-agente per la retrospettiva del Dottore.

Il Dottore (redesign 2026-06-13: archivista+riavviatore di sessioni a inizio/metà
giornata) intervista ogni agente e ne scrive una sintesi DENSA in append. Questo
script fornisce la METÀ ANALITICA di quella sintesi: estrae dai log/DB i numeri
oggettivi su cosa ha fatto un agente nella sua sessione, così la sintesi non si
basa solo sul racconto dell'agente.

Uso:
    python3 doctor_analytics.py <SESSION> <since_iso> [--db PATH] [--messages PATH]
                                [--session-created EPOCH] [--throttle PATH]

Esempio:
    python3 doctor_analytics.py SCOUT-1 2026-06-12T20:00:00Z

Stampa su stdout UN oggetto JSON (contratto lockato nel design-doc DOTTORE-REDESIGN):
    {
      "session", "role", "instance", "session_created", "session_age_h",
      "window": {"since", "until"},
      "produced": {"found", "analyzed", "scored", "written", "reviewed"},
      "communications": {"sent", "received", "top_peers": [["capitano", 12], ...]},
      "throttles": {"events", "max_sleep_s"},
      "last_captain_msg": "<ts>" | null,   # per la regola "parcheggiata" del Dottore
      "notes": [ ... avvisi non fatali ... ]
    }

Difensivo by design: DB/file mancanti o colonne assenti NON fanno crashare —
ritorna i campi calcolabili e mette il resto a 0/None con una nota. È sola-lettura.
"""
import argparse
import collections
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

# Mappa ruolo → (tabella, colonna autore, colonna timestamp) per la "produzione".
# Lo split degli analytics (dev2) consuma le colonne *_by/*_at già esistenti in
# jobs.db (shared/skills/_db.py): found_by/analyzed_by/scored_by/written_by/reviewed_by.
PRODUCTION = {
    "scout":     ("positions",    "found_by",    "found_at",          "found"),
    "analista":  ("positions",    "analyzed_by", "last_checked",      "analyzed"),
    "scorer":    ("scores",       "scored_by",   "scored_at",         "scored"),
    "scrittore": ("applications", "written_by",  "written_at",        "written"),
    "critico":   ("applications", "reviewed_by", "critic_reviewed_at", "reviewed"),
}

DEFAULT_HOME = os.environ.get("JHT_HOME", "/jht_home")


def _norm_iso(s):
    """ISO string → datetime aware (UTC). Tollera 'Z' e offset assenti."""
    if not s:
        return None
    try:
        t = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _parse_session(session):
    """SCOUT-1 → ('scout', 1).  CAPITANO → ('capitano', None)."""
    name = session.strip().lower()
    if "-" in name:
        base, _, inst = name.rpartition("-")
        if inst.isdigit():
            return base, int(inst)
    return name, None


def _table_cols(conn, table):
    try:
        return {r[1] for r in conn.execute("PRAGMA table_info(%s)" % table)}
    except sqlite3.Error:
        return set()


def _count_produced(conn, role, session, since, notes):
    """Conta gli artefatti prodotti dall'agente nella finestra. Il match su
    autore è LIKE '<session>%' perché i *_by sono scritti come 'scout-1' o
    'scout-1 (codex)' a seconda dell'agente — prefisso = robusto."""
    spec = PRODUCTION.get(role)
    if not spec:
        return None
    table, by_col, ts_col, label = spec
    cols = _table_cols(conn, table)
    if not cols:
        notes.append("missing table %s" % table)
        return {label: 0}
    if by_col not in cols:
        notes.append("missing column %s.%s" % (table, by_col))
        return {label: 0}
    where = ["%s LIKE ?" % by_col]
    params = [session.lower() + "%"]
    if ts_col in cols and since:
        where.append("%s >= ?" % ts_col)
        params.append(since)
    else:
        if ts_col not in cols:
            notes.append("missing timestamp column %s.%s → count is not filtered by window" % (table, ts_col))
    q = "SELECT COUNT(*) FROM %s WHERE %s" % (table, " AND ".join(where))
    try:
        n = conn.execute(q, params).fetchone()[0]
    except sqlite3.Error as e:
        notes.append("produced query failed: %s" % e)
        n = 0
    return {label: n}


def _communications(messages_path, session, since_dt, notes):
    """Da messages.jsonl: messaggi inviati/ricevuti dall'agente + top peer.
    Anche l'ultimo messaggio ricevuto DAL CAPITANO (serve alla regola del
    Dottore 'sessione parcheggiata = vecchia ma nessun ordine recente')."""
    name = session.lower()
    sent = received = 0
    peers = collections.Counter()
    last_captain_msg = None
    if not os.path.exists(messages_path):
        notes.append("messages.jsonl is missing (%s)" % messages_path)
        return {"sent": 0, "received": 0, "top_peers": []}, None
    try:
        with open(messages_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                ts = _norm_iso(d.get("ts"))
                if since_dt and ts and ts < since_dt:
                    continue
                frm = (d.get("from") or "").lower()
                to = (d.get("to") or "").lower()
                if frm == name:
                    sent += 1
                    if to:
                        peers[to] += 1
                if to == name or to == "all":
                    received += 1
                    if frm:
                        peers[frm] += 1
                    if frm == "capitano" and d.get("ts"):
                        # tieni il più recente
                        if last_captain_msg is None or d["ts"] > last_captain_msg:
                            last_captain_msg = d["ts"]
    except OSError as e:
        notes.append("failed to read messages.jsonl: %s" % e)
    return {"sent": sent, "received": received, "top_peers": peers.most_common(4)}, last_captain_msg


def _throttles(throttle_path, session, since_dt, notes):
    """Eventi di throttle sull'agente = proxy degli 'intoppi' (il Capitano lo
    rallenta quando sfora). File opzionale; se assente → zeri con nota."""
    name = session.lower()
    events = 0
    max_sleep = 0
    if not throttle_path or not os.path.exists(throttle_path):
        notes.append("throttle log is missing → slowdowns cannot be quantified")
        return {"events": 0, "max_sleep_s": 0}
    try:
        with open(throttle_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                target = (d.get("agent") or d.get("target") or d.get("name") or "").lower()
                if target != name:
                    continue
                ts = _norm_iso(d.get("ts"))
                if since_dt and ts and ts < since_dt:
                    continue
                events += 1
                s = d.get("applied_sec") or d.get("sleep") or d.get("sleep_s") or 0
                try:
                    max_sleep = max(max_sleep, int(s))
                except (ValueError, TypeError):
                    pass
    except OSError as e:
        notes.append("failed to read throttle log: %s" % e)
    return {"events": events, "max_sleep_s": max_sleep}


def collect(session, since_iso, db_path, messages_path, throttle_path, session_created):
    notes = []
    role, instance = _parse_session(session)
    since_dt = _norm_iso(since_iso)
    now = datetime.now(timezone.utc)

    # età sessione
    age_h = None
    created_iso = None
    if session_created:
        try:
            created = datetime.fromtimestamp(float(session_created), timezone.utc)
            created_iso = created.isoformat().replace("+00:00", "Z")
            age_h = round((now - created).total_seconds() / 3600.0, 2)
        except (ValueError, OSError, TypeError):
            notes.append("invalid session_created value")

    # produzione
    produced = None
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
            produced = _count_produced(conn, role, session, since_iso, notes)
            conn.close()
        except sqlite3.Error as e:
            notes.append("failed to open database: %s" % e)
    else:
        notes.append("jobs.db is missing (%s)" % db_path)
    if produced is None:
        produced = {}
        if role not in PRODUCTION:
            notes.append("role '%s' does not produce tracked artifacts (singleton/monitoring)" % role)

    comms, last_captain = _communications(messages_path, session, since_dt, notes)
    throttles = _throttles(throttle_path, session, since_dt, notes)

    return {
        "session": session,
        "role": role,
        "instance": instance,
        "session_created": created_iso,
        "session_age_h": age_h,
        "window": {"since": since_iso, "until": now.isoformat().replace("+00:00", "Z")},
        "produced": produced,
        "communications": comms,
        "throttles": throttles,
        "last_captain_msg": last_captain,
        "notes": notes,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="Per-agent metrics for the Doctor retrospective")
    p.add_argument("session", help="tmux session name (for example SCOUT-1 or CAPITANO)")
    p.add_argument("since_iso", help="ISO-UTC window start (for example 2026-06-12T20:00:00Z)")
    p.add_argument("--db", default=os.path.join(DEFAULT_HOME, "jobs.db"))
    p.add_argument("--messages", default=os.path.join(DEFAULT_HOME, "logs", "messages.jsonl"))
    p.add_argument("--throttle", default=os.path.join(DEFAULT_HOME, "logs", "throttle-events.jsonl"))
    p.add_argument("--session-created", default=None, help="session creation epoch (tmux #{session_created})")
    args = p.parse_args(argv)

    out = collect(args.session, args.since_iso, args.db, args.messages, args.throttle, args.session_created)
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
