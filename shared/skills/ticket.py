#!/usr/bin/env python3
"""ticket.py — gestione dei ticket utente→team su una posizione.

L'utente crea un ticket dalla pagina posizione (via web API → tabella
`position_tickets`, status 'open'). Qui le operazioni del TEAM:

    python3 ticket.py list-open                      # coda del Capitano (ticket aperti)
    python3 ticket.py count-open                      # solo il numero di aperti (heartbeat/monitor)
    python3 ticket.py assign <id> <agente>           # il Capitano assegna ('assigned')
    python3 ticket.py resolve <id> --response "..."  # l'agente risolve ('resolved')
    python3 ticket.py show <id>                       # ispezione singolo ticket
    python3 ticket.py for-position <position_id>      # tutti i ticket di una posizione

Flusso: open → (Capitano: assign) assigned → (agente: resolve) resolved.
La risposta testuale (response_text) è ciò che l'utente vede nella sezione
dedicata della pagina posizione. Single-writer: solo il team scrive qui.
"""
import argparse
import sys

from _db import get_db, ensure_schema


def _fmt(t) -> str:
    # `kind` è routing, non decorazione: `rescore` deve andare allo Scorer.
    # Senza mostrarlo, il Capitano vedrebbe solo prosa libera e potrebbe
    # assegnare la richiesta all'agente sbagliato.
    head = (f"#{t['id']} [pos {t['position_id']}] {t['status']} "
            f"kind={t['kind'] or 'custom'}")
    if t['assigned_agent']:
        head += f" → {t['assigned_agent']}"
    lines = [head, f"   request : {t['request_text']}"]
    if t['response_text']:
        lines.append(f"   response: {t['response_text']}")
    return "\n".join(lines)


def open_ticket(conn, position_id: int, text: str, kind: str = "custom") -> int:
    """Apre un ticket dell'UTENTE su una posizione. Ritorna l'id creato.

    Aggiunta il 2026-07-25: fino ad allora questa operazione viveva solo dentro
    `web/app/api/positions/[legacyId]/ticket/route.ts`, quindi si poteva aprire
    un ticket solo da un browser — il CLI e gli agenti che lo guidano non
    avevano modo di farlo. Stessa INSERT della route (kind + status 'open').

    Il mirror su Supabase NON si fa qui: lo fa il daemon con
    `jht cloud sync-tickets`, che correla via `cloud_id`. Scriverlo anche qui
    creava una riga cloud scollegata che il pull ri-importava come duplicato.
    """
    if not (text or "").strip():
        raise ValueError("request text cannot be empty")
    row = conn.execute(
        "SELECT id FROM positions WHERE id = ?", (position_id,)
    ).fetchone()
    if not row:
        raise LookupError(f"position #{position_id} not found")
    cur = conn.execute(
        "INSERT INTO position_tickets (position_id, request_text, kind, status) "
        "VALUES (?, ?, ?, 'open')",
        (position_id, text.strip(), kind),
    )
    conn.commit()
    return int(cur.lastrowid)


def list_open(conn) -> None:
    rows = conn.execute(
        "SELECT * FROM position_tickets WHERE status = 'open' "
        "ORDER BY created_at ASC"
    ).fetchall()
    if not rows:
        print("No open tickets.")
        return
    print(f"OPEN tickets ({len(rows)}) — assign them with: ticket.py assign <id> <agent>")
    for t in rows:
        print(_fmt(t))


def count_open(conn) -> None:
    """Stampa SOLO il numero di ticket aperti (monitor: heartbeat-bridge).
    Output stabile e localizzazione-immune, a differenza di list-open."""
    n = conn.execute(
        "SELECT COUNT(*) FROM position_tickets WHERE status = 'open'"
    ).fetchone()[0]
    print(n)


def assign(conn, ticket_id: int, agent: str) -> None:
    cur = conn.execute(
        "UPDATE position_tickets SET status = 'assigned', assigned_agent = ?, "
        "assigned_at = datetime('now','localtime'), "
        "updated_at = datetime('now','localtime') "
        "WHERE id = ? AND status IN ('open','assigned')",
        (agent, ticket_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        print(f"Ticket #{ticket_id} not found or already resolved.", file=sys.stderr)
        sys.exit(1)
    print(f"Ticket #{ticket_id} assigned to {agent}.")


def resolve(conn, ticket_id: int, response: str) -> None:
    response = (response or "").strip()
    if not response:
        print("Response cannot be empty.", file=sys.stderr)
        sys.exit(1)
    # Per un ticket normale la risposta è l'effetto. Per ``rescore`` è solo
    # la descrizione dell'effetto: il dato promesso è una NUOVA riga logica in
    # ``scores`` (la tabella è single-state e viene riscritta). Il confronto
    # con created_at è il baseline persistito già disponibile sul ticket.
    # Tenerlo nella WHERE rende verifica + risoluzione atomiche: un prompt che
    # dice allo Scorer di controllare non basta a impedire un ACK prematuro.
    cur = conn.execute(
        "UPDATE position_tickets AS ticket "
        "SET status = 'resolved', response_text = ?, "
        "resolved_at = datetime('now','localtime'), "
        "updated_at = datetime('now','localtime') "
        "WHERE ticket.id = ? "
        "AND (ticket.kind <> 'rescore' OR EXISTS ("
        "  SELECT 1 FROM scores s "
        "  WHERE s.position_id = ticket.position_id "
        "    AND julianday(s.scored_at) > julianday(ticket.created_at)"
        "))",
        (response, ticket_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        ticket = conn.execute(
            "SELECT kind FROM position_tickets WHERE id = ?", (ticket_id,)
        ).fetchone()
        if ticket and ticket['kind'] == 'rescore':
            print(
                f"Ticket #{ticket_id} cannot be resolved: rescore effect not "
                "verified (scores.scored_at must be newer than the ticket "
                "request). Run db_insert.py score --action rescore first.",
                file=sys.stderr,
            )
        else:
            print(f"Ticket #{ticket_id} not found.", file=sys.stderr)
        sys.exit(1)
    print(f"Ticket #{ticket_id} resolved (response visible to the user).")


def show(conn, ticket_id: int) -> None:
    t = conn.execute(
        "SELECT * FROM position_tickets WHERE id = ?", (ticket_id,)
    ).fetchone()
    if not t:
        print(f"Ticket #{ticket_id} not found.", file=sys.stderr)
        sys.exit(1)
    print(_fmt(t))


def for_position(conn, position_id: int) -> None:
    rows = conn.execute(
        "SELECT * FROM position_tickets WHERE position_id = ? "
        "ORDER BY created_at ASC",
        (position_id,),
    ).fetchall()
    if not rows:
        print(f"No tickets for position {position_id}.")
        return
    for t in rows:
        print(_fmt(t))


def main() -> None:
    ap = argparse.ArgumentParser(description="Manage user-to-team tickets")
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("open", help="open a user ticket for a position")
    o.add_argument("position_id", type=int)
    o.add_argument("text", help="what you are asking the team")
    o.add_argument("--kind", default="custom")
    sub.add_parser("list-open")
    sub.add_parser("count-open")
    a = sub.add_parser("assign")
    a.add_argument("id", type=int)
    a.add_argument("agent")
    r = sub.add_parser("resolve")
    r.add_argument("id", type=int)
    r.add_argument("--response", required=True)
    s = sub.add_parser("show")
    s.add_argument("id", type=int)
    f = sub.add_parser("for-position")
    f.add_argument("position_id", type=int)
    args = ap.parse_args()

    conn = get_db()
    ensure_schema(conn)
    try:
        if args.cmd == "open":
            try:
                new_id = open_ticket(conn, args.position_id, args.text, args.kind)
            except (ValueError, LookupError) as e:
                print(f"✗ {e}", file=sys.stderr)
                sys.exit(1)
            print(f"✓ ticket #{new_id} opened for position #{args.position_id} "
                  f"(status 'open', queued for the Captain)")
        elif args.cmd == "list-open":
            list_open(conn)
        elif args.cmd == "count-open":
            count_open(conn)
        elif args.cmd == "assign":
            assign(conn, args.id, args.agent)
        elif args.cmd == "resolve":
            resolve(conn, args.id, args.response)
        elif args.cmd == "show":
            show(conn, args.id)
        elif args.cmd == "for-position":
            for_position(conn, args.position_id)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
