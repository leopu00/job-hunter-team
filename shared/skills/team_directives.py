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
from provider_directive_policy import for_prompt, is_provider_instruction

KINDS = ("order", "strategy", "formation", "note")
AUTHORS = ("user", "capitano", "assistente")


def _fmt(d, indent="  ", prompt_safe: bool = False) -> str:
    body = d["body"]
    if prompt_safe:
        body, _ignored = for_prompt(body)
    return f"{indent}#{d['id']} [{d['kind']}] {body}"


def _active_rows(conn):
    return conn.execute(
        "SELECT * FROM team_directives WHERE status = 'active' "
        "ORDER BY sort_order ASC, created_at ASC"
    ).fetchall()


def cmd_active(conn) -> None:
    """Direttive attive, formattate per l'handoff del Capitano al riavvio."""
    rows = _active_rows(conn)
    if not rows:
        print("📋 TEAM BOARD — no active directives.")
        return
    print(f"📋 TEAM BOARD — ACTIVE directives ({len(rows)}), valid until the user changes them:")
    for d in rows:
        print(_fmt(d, prompt_safe=True))


def cmd_list(conn, show_all: bool) -> None:
    if show_all:
        rows = conn.execute(
            "SELECT * FROM team_directives ORDER BY status ASC, sort_order ASC, created_at ASC"
        ).fetchall()
    else:
        rows = _active_rows(conn)
    if not rows:
        print("No directives." if show_all else "No active directives.")
        return
    for d in rows:
        tag = "" if d["status"] == "active" else " (archived)"
        print(_fmt(d) + f"  by {d['created_by']}{tag}")


def cmd_add(conn, body: str, kind: str, by: str) -> None:
    body = (body or "").strip()
    if not body:
        print("Directive text cannot be empty.", file=sys.stderr)
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
    print(f"Directive #{cur.lastrowid} added [{kind}].")
    if is_provider_instruction(body):
        print("Ignored for agent prompts: provider/model/CLI selection is configuration-only.")


def cmd_edit(conn, directive_id: int, body: str) -> None:
    body = (body or "").strip()
    if not body:
        print("Directive text cannot be empty.", file=sys.stderr)
        sys.exit(1)
    cur = conn.execute(
        "UPDATE team_directives SET body = ?, updated_at = datetime('now','localtime') "
        "WHERE id = ?",
        (body, directive_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        print(f"Directive #{directive_id} not found.", file=sys.stderr)
        sys.exit(1)
    print(f"Directive #{directive_id} updated.")
    if is_provider_instruction(body):
        print("Ignored for agent prompts: provider/model/CLI selection is configuration-only.")


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
        print(f"Directive #{directive_id} not found or already archived.", file=sys.stderr)
        sys.exit(1)
    print(f"Directive #{directive_id} archived.")


def cmd_show(conn, directive_id: int) -> None:
    d = conn.execute(
        "SELECT * FROM team_directives WHERE id = ?", (directive_id,)
    ).fetchone()
    if not d:
        print(f"Directive #{directive_id} not found.", file=sys.stderr)
        sys.exit(1)
    print(_fmt(d, indent=""))
    print(f"  status={d['status']} by={d['created_by']} created={d['created_at']} updated={d['updated_at']}")


def main() -> None:
    p = argparse.ArgumentParser(description="Team board — permanent user directives.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("active", help="active directives (Captain handoff)")

    pl = sub.add_parser("list", help="list directives")
    pl.add_argument("--all", action="store_true", help="include archived directives")

    pa = sub.add_parser("add", help="add a directive")
    pa.add_argument("body")
    pa.add_argument("--kind", choices=KINDS, default="order")
    pa.add_argument("--by", choices=AUTHORS, default="user")

    pe = sub.add_parser("edit", help="edit directive text")
    pe.add_argument("id", type=int)
    pe.add_argument("body")

    par = sub.add_parser("archive", help="archive a directive")
    par.add_argument("id", type=int)

    ps = sub.add_parser("show", help="inspect a directive")
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
