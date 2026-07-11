#!/usr/bin/env python3
"""team_directives.py — bacheca del team: ordini/direttive PERMANENTI dell'utente.

A differenza del captain-diary (per-giorno, lezioni di pacing che si accumulano),
la bacheca tiene le direttive che l'utente vuole ATTIVE finché non le cambia:
strategia/formazione (es. "modalità mantenimento"), policy operative (es. "CV solo
90+", "stop scouting", "verifica freschezza prima del CV"). Il Capitano le rilegge
a OGNI riavvio (handoff), così non le perde al context-refresh.

Operazioni del TEAM (single-writer: qui scrive solo il team; la dashboard web
scriverà via API → mirror Supabase, prossimo incremento):

    python3 team_directives.py active                 # direttive ATTIVE (handoff Capitano/Assistente)
    python3 team_directives.py add "<testo>" [--kind order|strategy|formation|note] [--by user|capitano|assistente]
    python3 team_directives.py edit <id> "<testo>"    # modifica il corpo
    python3 team_directives.py archive <id>           # ritira una direttiva (status 'archived')
    python3 team_directives.py show <id>              # ispezione singola
    python3 team_directives.py list [--all]           # attive (o tutte con --all)

Convenzioni allineate a ticket.py: _db.get_db/ensure_schema, timestamp
datetime('now','localtime'), status CHECK. La tabella è in _db.py (team_directives).
"""
import argparse
import sys

from _db import get_db, ensure_schema

KINDS = ("order", "strategy", "formation", "note")
AUTHORS = ("user", "capitano", "assistente")


def _fmt(d, indent="  ") -> str:
    return f"{indent}#{d['id']} [{d['kind']}] {d['body']}"


def _active_rows(conn):
    return conn.execute(
        "SELECT * FROM team_directives WHERE status = 'active' "
        "ORDER BY sort_order ASC, created_at ASC"
    ).fetchall()


def cmd_active(conn) -> None:
    """Direttive attive, formattate per l'handoff del Capitano al riavvio."""
    rows = _active_rows(conn)
    if not rows:
        print("📋 BACHECA DEL TEAM — nessuna direttiva attiva.")
        return
    print(f"📋 BACHECA DEL TEAM — direttive ATTIVE ({len(rows)}), valide finché l'utente non le cambia:")
    for d in rows:
        print(_fmt(d))


def cmd_list(conn, show_all: bool) -> None:
    if show_all:
        rows = conn.execute(
            "SELECT * FROM team_directives ORDER BY status ASC, sort_order ASC, created_at ASC"
        ).fetchall()
    else:
        rows = _active_rows(conn)
    if not rows:
        print("Nessuna direttiva." if show_all else "Nessuna direttiva attiva.")
        return
    for d in rows:
        tag = "" if d["status"] == "active" else " (archiviata)"
        print(_fmt(d) + f"  by {d['created_by']}{tag}")


def cmd_add(conn, body: str, kind: str, by: str) -> None:
    body = (body or "").strip()
    if not body:
        print("Il testo della direttiva non può essere vuoto.", file=sys.stderr)
        sys.exit(1)
    # nuova direttiva in coda: sort_order = max(attive) + 1
    nxt = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM team_directives WHERE status = 'active'"
    ).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO team_directives (body, kind, created_by, sort_order) "
        "VALUES (?, ?, ?, ?)",
        (body, kind, by, nxt),
    )
    conn.commit()
    print(f"Direttiva #{cur.lastrowid} aggiunta [{kind}].")


def cmd_edit(conn, directive_id: int, body: str) -> None:
    body = (body or "").strip()
    if not body:
        print("Il testo della direttiva non può essere vuoto.", file=sys.stderr)
        sys.exit(1)
    cur = conn.execute(
        "UPDATE team_directives SET body = ?, updated_at = datetime('now','localtime') "
        "WHERE id = ?",
        (body, directive_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        print(f"Direttiva #{directive_id} non trovata.", file=sys.stderr)
        sys.exit(1)
    print(f"Direttiva #{directive_id} aggiornata.")


def cmd_archive(conn, directive_id: int) -> None:
    cur = conn.execute(
        "UPDATE team_directives SET status = 'archived', "
        "archived_at = datetime('now','localtime'), "
        "updated_at = datetime('now','localtime') "
        "WHERE id = ? AND status = 'active'",
        (directive_id,),
    )
    conn.commit()
    if cur.rowcount == 0:
        print(f"Direttiva #{directive_id} non trovata o già archiviata.", file=sys.stderr)
        sys.exit(1)
    print(f"Direttiva #{directive_id} archiviata.")


def cmd_show(conn, directive_id: int) -> None:
    d = conn.execute(
        "SELECT * FROM team_directives WHERE id = ?", (directive_id,)
    ).fetchone()
    if not d:
        print(f"Direttiva #{directive_id} non trovata.", file=sys.stderr)
        sys.exit(1)
    print(_fmt(d, indent=""))
    print(f"  status={d['status']} by={d['created_by']} creata={d['created_at']} agg={d['updated_at']}")


def main() -> None:
    p = argparse.ArgumentParser(description="Bacheca del team — direttive permanenti dell'utente.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("active", help="direttive attive (handoff Capitano)")

    pl = sub.add_parser("list", help="elenca le direttive")
    pl.add_argument("--all", action="store_true", help="includi anche le archiviate")

    pa = sub.add_parser("add", help="aggiungi una direttiva")
    pa.add_argument("body")
    pa.add_argument("--kind", choices=KINDS, default="order")
    pa.add_argument("--by", choices=AUTHORS, default="user")

    pe = sub.add_parser("edit", help="modifica il testo di una direttiva")
    pe.add_argument("id", type=int)
    pe.add_argument("body")

    par = sub.add_parser("archive", help="ritira una direttiva")
    par.add_argument("id", type=int)

    ps = sub.add_parser("show", help="ispeziona una direttiva")
    ps.add_argument("id", type=int)

    args = p.parse_args()
    conn = get_db()
    ensure_schema(conn)

    if args.cmd == "active":
        cmd_active(conn)
    elif args.cmd == "list":
        cmd_list(conn, args.all)
    elif args.cmd == "add":
        cmd_add(conn, args.body, args.kind, args.by)
    elif args.cmd == "edit":
        cmd_edit(conn, args.id, args.body)
    elif args.cmd == "archive":
        cmd_archive(conn, args.id)
    elif args.cmd == "show":
        cmd_show(conn, args.id)


if __name__ == "__main__":
    main()
