#!/usr/bin/env python3
"""ticket.py — gestione dei ticket utente→team su una posizione.

L'utente crea un ticket dalla pagina posizione (via web API → tabella
`position_tickets`, status 'open'). Qui le operazioni del TEAM:

    python3 ticket.py list-open                      # coda del Capitano (aperti + assegnati)
    python3 ticket.py count-open                      # solo il numero di azionabili (heartbeat/monitor)
    python3 ticket.py assign <id> <agente>           # il Capitano assegna ('assigned')
    python3 ticket.py resolve <id> --response "..."  # l'agente risolve ('resolved')
    python3 ticket.py show <id>                       # ispezione singolo ticket
    python3 ticket.py for-position <position_id>      # tutti i ticket di una posizione

Flusso: open → (Capitano: assign) assigned → (agente: resolve) resolved.

'assigned' NON è uno stato che si tiene da solo (O-164). Un ticket che non
avanza — nessuna traccia di lavoro sulla sua posizione da ore — torna 'open'
alla prima `list-open`, che l'assegnatario sia sparito o soltanto fermo. La
domanda è «questo ticket sta andando avanti?», non «l'agente esiste?»: dei
quattro ticket bloccati, uno era di un agente VIVO che non lo toccava da 98
ore, e nessuno dei due stati produceva un errore.

La risposta testuale (response_text) è ciò che l'utente vede nella sezione
dedicata della pagina posizione. Single-writer: solo il team scrive qui.
"""
import argparse
import os
import sys

from _db import get_db, ensure_schema
from artifact import is_uploaded_document_path


ATTACHMENT_MARKER = "[FILE ALLEGATI]"
REQUEST_MAX_CHARS = 2000

# Da quante ore SENZA UN AVANZAMENTO un ticket assegnato torna in coda.
#
# La soglia misura l'immobilità, non l'anzianità: un CV che richiede ore resta
# dell'agente finché quell'agente produce qualcosa sulla posizione. I quattro
# casi di O-164 erano fermi 76, 77, 98 e 98 ore; sei ore stanno larghe sopra
# qualunque lavoro vero e strettissime sotto il più breve di quei quattro.
STALE_IDLE_HOURS = 6

# ⚠️ QUI I TIMESTAMP NON SONO SULLA STESSA BASE ORARIA, e la cosa non si vede
# leggendo una query alla volta:
#
#   UTC     → `position_tickets.created_at` (DEFAULT CURRENT_TIMESTAMP),
#             `scores.scored_at` (strftime(...,'now'))
#   LOCALE  → `position_tickets.assigned_at`, `positions.last_checked`,
#             `applications.written_at` (tutti `datetime('now','localtime')`)
#
# Confrontarli con un unico `now` sbaglia di tutto il fuso — due ore in Italia,
# di più altrove — e sbaglia in SILENZIO, che su una scadenza è il modo
# peggiore: un ticket fermo da 5 ore risulterebbe fermo da 7. Ogni colonna
# viene quindi riportata a UTC con il modificatore `'utc'` PRIMA di entrare in
# un confronto, e il riferimento è sempre `julianday('now')`, che è UTC.
_UTC = "julianday({col})"
_LOCAL_TO_UTC = "julianday({col}, 'utc')"

_AGE_HOURS = f"(julianday('now') - {_UTC.format(col='created_at')}) * 24.0"
_ASSIGNED_HOURS = (
    f"(julianday('now') - {_LOCAL_TO_UTC.format(col='assigned_at')}) * 24.0"
)

# L'ultimo segno che QUALCUNO STA LAVORANDO su quella posizione: è la domanda
# vera («il ticket sta avanzando?»), non «l'agente esiste?». Un agente vivo che
# tiene un ticket senza toccarlo è il caso che ha smontato la diagnosi ovvia —
# JHT-1173 era di scorer-3, sessione attiva, fermo 98 ore.
#
# Le tre tracce sono quelle che il team lascia lavorando una posizione, le
# stesse che `team_roster.PRODUCTION` usa per dire se un worker produce.
# `MAX()` propaga NULL, quindi ogni ramo passa da IFNULL: senza, una posizione
# senza punteggi renderebbe muto anche il resto.
_LAST_PROGRESS = f"""(
    SELECT MAX(
        IFNULL({_LOCAL_TO_UTC.format(col='p.last_checked')}, 0),
        IFNULL((SELECT MAX({_UTC.format(col='s.scored_at')}) FROM scores s
                 WHERE s.position_id = position_tickets.position_id), 0),
        IFNULL((SELECT MAX({_LOCAL_TO_UTC.format(col='a.written_at')})
                  FROM applications a
                 WHERE a.position_id = position_tickets.position_id), 0)
    )
    FROM positions p WHERE p.id = position_tickets.position_id
)"""

# Ore dall'ultimo movimento: l'assegnazione stessa conta come primo segno, così
# un ticket appena assegnato non nasce già scaduto.
_IDLE_HOURS = f"""(julianday('now') - MAX(
    IFNULL({_LOCAL_TO_UTC.format(col='assigned_at')}, 0),
    IFNULL({_LAST_PROGRESS}, 0)
)) * 24.0"""


def request_with_attachment(text: str, attachment_path: str | None = None) -> str:
    """Costruisce il solo formato ticket che può riferire un allegato.

    I byte restano nella drop-zone governata da ``artifact.py``; nel DB passa
    soltanto il path container restituito da quel trasporto. Il marker è già
    il protocollo usato dall'Assistente per distinguere un documento dai
    comandi: nessuna colonna o coda parallela da sincronizzare.
    """
    request = (text or "").strip()
    if not request:
        raise ValueError("request text cannot be empty")
    if len(request) > REQUEST_MAX_CHARS:
        raise ValueError(f"request text exceeds {REQUEST_MAX_CHARS} characters")
    if not attachment_path:
        return request
    if not is_uploaded_document_path(attachment_path):
        raise ValueError("invalid attachment path")
    return f"{request}\n\n{ATTACHMENT_MARKER}\n{attachment_path}"


def _stale_hours() -> float:
    try:
        return float(os.environ.get("JHT_TICKET_IDLE_HOURS") or STALE_IDLE_HOURS)
    except (TypeError, ValueError):
        return float(STALE_IDLE_HOURS)


def _age_text(hours) -> str:
    """Attesa in forma leggibile. Un ticket di tre giorni deve SEMBRARE di tre
    giorni: `2026-08-13 09:14:02` non lo dice a nessuno."""
    if hours is None:
        return "?"
    hours = max(0.0, float(hours))
    days, rem = divmod(hours, 24)
    if days >= 1:
        return f"{int(days)}g {int(rem)}h"
    if hours >= 1:
        return f"{int(hours)}h {int((hours % 1) * 60)}m"
    return f"{int(hours * 60)}m"


def live_agents():
    """Sessioni tmux vive, o ``None`` se la liveness non è stabilibile.

    La distinzione è tutto il senso di questa funzione. ``live_sessions()``
    ritorna un set vuoto in DUE casi diversi — «nessun agente è vivo» e «tmux
    non ha risposto» — e trattarli allo stesso modo significherebbe, la prima
    volta che tmux non risponde, dichiarare morti TUTTI gli assegnatari e
    svuotare in blocco le assegnazioni del team. Un'assenza dice dove siamo
    adesso, non cosa è successo: qui vale ``None`` = non lo so, e chi non sa
    non reclama.
    """
    try:
        from team_roster import live_sessions
    except ImportError:
        return None
    return live_sessions() or None


def _reason_for(row, live, stale_hours: float):
    """Perché questo ticket assegnato non sta andando da nessuna parte.

    L'ordine dice la gerarchia dei criteri, ed è la correzione che il dato di
    JHT-1173 ha imposto: **fermo** viene prima di **orfano**. Un agente vivo
    che non tocca il ticket lo blocca esattamente quanto un agente sparito, ed
    era uno dei quattro casi — un fix che guardasse solo le sessioni morte lo
    avrebbe lasciato fuori. L'assegnatario mancante resta un motivo valido, ma
    è il secondo: chiude il caso in cui il ticket è fermo da poco e sappiamo
    già che nessuno lo riprenderà.
    """
    idle = row['idle_hours']
    if idle is not None and idle >= stale_hours:
        return f"no progress for {_age_text(idle)}"
    agent = (row['assigned_agent'] or "").strip()
    if live is not None and agent and agent.upper() not in live:
        return f"{agent} is no longer alive"
    return None


def stale_assignments(conn, live=None, stale_hours: float | None = None) -> list:
    """I ticket 'assigned' che nessuno sta più lavorando, col motivo. Read-only."""
    hours = _stale_hours() if stale_hours is None else stale_hours
    rows = conn.execute(
        f"SELECT *, {_ASSIGNED_HOURS} AS assigned_hours, {_IDLE_HOURS} AS idle_hours "
        "FROM position_tickets "
        "WHERE status = 'assigned' AND resolved_at IS NULL "
        "ORDER BY created_at ASC"
    ).fetchall()
    out = []
    for row in rows:
        reason = _reason_for(row, live, hours)
        if reason:
            out.append((row, reason))
    return out


def reclaim_stale(conn, live=None, stale_hours: float | None = None) -> list:
    """Rimette in coda i ticket assegnati a chi non c'è più o fermi da troppo.

    È il cuore di O-164: due ticket erano assegnati ad agenti spariti in un
    riavvio, e quello stato non produceva NESSUN errore — solo lavoro che non
    avrebbe fatto più nessuno. Nessuna colonna nuova: `status` torna 'open' e
    `assigned_agent`/`assigned_at` si azzerano, perché un ticket aperto che
    dichiara ancora un assegnatario è un terzo stato che nessuno legge.

    Ritorna la lista `(id, agente, motivo)` di ciò che ha rimesso in coda: chi
    chiama la STAMPA, così il recupero si vede invece di avvenire di nascosto.
    """
    reclaimed = []
    for row, reason in stale_assignments(conn, live, stale_hours):
        cur = conn.execute(
            "UPDATE position_tickets SET status = 'open', assigned_agent = NULL, "
            "assigned_at = NULL, updated_at = datetime('now','localtime') "
            "WHERE id = ? AND status = 'assigned'",
            (row['id'],),
        )
        if cur.rowcount:
            reclaimed.append((row['id'], row['assigned_agent'], reason))
    if reclaimed:
        conn.commit()
    return reclaimed


def _col(row, name):
    """Colonna calcolata se c'è: `show`/`for-position` non le selezionano."""
    try:
        return row[name]
    except (IndexError, KeyError):
        return None


def _fmt(t) -> str:
    # `kind` è routing, non decorazione: `rescore` deve andare allo Scorer.
    # Senza mostrarlo, il Capitano vedrebbe solo prosa libera e potrebbe
    # assegnare la richiesta all'agente sbagliato.
    head = (f"#{t['id']} [pos {t['position_id']}] {t['status']} "
            f"kind={t['kind'] or 'custom'}")
    if t['assigned_agent']:
        head += f" → {t['assigned_agent']}"
    # L'attesa è il fatto che mancava: un ticket fermo da tre giorni e uno di
    # dieci minuti erano indistinguibili in questa riga.
    age = _col(t, 'age_hours')
    if age is not None:
        head += f" · waiting {_age_text(age)}"
    held = _col(t, 'assigned_hours')
    if held is not None:
        head += f" (assigned {_age_text(held)} ago"
        # Il numero che dice se è lavoro o immobilità. Senza, «assegnato da 98
        # ore» e «assegnato da 98 ore e nessuno l'ha toccato» si leggono uguali.
        idle = _col(t, 'idle_hours')
        head += f", idle {_age_text(idle)})" if idle is not None else ")"
    lines = [head, f"   request : {t['request_text']}"]
    if t['response_text']:
        lines.append(f"   response: {t['response_text']}")
    return "\n".join(lines)


def open_ticket(conn, position_id: int, text: str, kind: str = "custom",
                attachment_path: str | None = None) -> int:
    """Apre un ticket dell'UTENTE su una posizione. Ritorna l'id creato.

    Aggiunta il 2026-07-25: fino ad allora questa operazione viveva solo dentro
    `web/app/api/positions/[legacyId]/ticket/route.ts`, quindi si poteva aprire
    un ticket solo da un browser — il CLI e gli agenti che lo guidano non
    avevano modo di farlo. Stessa INSERT della route (kind + status 'open').

    Il mirror su Supabase NON si fa qui: lo fa il daemon con
    `jht cloud sync-tickets`, che correla via `cloud_id`. Scriverlo anche qui
    creava una riga cloud scollegata che il pull ri-importava come duplicato.
    """
    request_text = request_with_attachment(text, attachment_path)
    row = conn.execute(
        "SELECT id FROM positions WHERE id = ?", (position_id,)
    ).fetchone()
    if not row:
        raise LookupError(f"position #{position_id} not found")
    cur = conn.execute(
        "INSERT INTO position_tickets (position_id, request_text, kind, status) "
        "VALUES (?, ?, ?, 'open')",
        (position_id, request_text, kind),
    )
    conn.commit()
    return int(cur.lastrowid)


def list_open(conn, live=None) -> None:
    """La coda del Capitano: cosa c'è da assegnare, e chi sta già lavorando.

    Mostrava SOLO gli 'open'. Con quattro ticket tutti in 'assigned' rispondeva
    «No open tickets», cioè una coda vuota mentre quattro utenti aspettavano —
    e due erano assegnati ad agenti che non esistevano più (O-164). Un comando
    che dice «niente da fare» deve essere vero anche quando la verità è
    scomoda: qui gli assegnati si vedono, con da quanto sono fermi.

    Prima di elencare, i ticket senza più nessuno che ci lavori rientrano in
    coda: è l'unico punto in cui il Capitano passa per forza, quindi è qui che
    il recupero deve avvenire senza che nessuno se ne accorga a mano.

    FIFO invariato (`ORDER BY created_at ASC`, O-68): questa funzione cambia
    COSA si vede, mai in che ordine.
    """
    reclaimed = reclaim_stale(conn, live)
    for ticket_id, agent, reason in reclaimed:
        print(f"↩ #{ticket_id} back in the queue — was {agent}: {reason}")

    rows = conn.execute(
        f"SELECT *, {_AGE_HOURS} AS age_hours FROM position_tickets "
        "WHERE status = 'open' "
        "ORDER BY created_at ASC"
    ).fetchall()
    assigned = conn.execute(
        f"SELECT *, {_AGE_HOURS} AS age_hours, {_ASSIGNED_HOURS} AS assigned_hours, "
        f"{_IDLE_HOURS} AS idle_hours "
        "FROM position_tickets WHERE status = 'assigned' "
        "ORDER BY created_at ASC"
    ).fetchall()

    if not rows and not assigned:
        print("No open tickets.")
        return

    if rows:
        print(f"OPEN tickets ({len(rows)}) — assign them with: ticket.py assign <id> <agent>")
        for t in rows:
            print(_fmt(t))
    else:
        # Il caso del report: nessun 'open', e senza questa riga il Capitano
        # leggerebbe di nuovo una coda vuota.
        print("OPEN tickets (0) — nothing to assign right now.")

    if assigned:
        print(f"ASSIGNED ({len(assigned)}) — already being worked on, do NOT reassign:")
        for t in assigned:
            print(_fmt(t))


def count_open(conn, live=None) -> None:
    """Stampa SOLO il numero di ticket AZIONABILI (monitor: heartbeat-bridge).
    Output stabile e localizzazione-immune, a differenza di list-open.

    Azionabili = gli 'open' PIÙ gli assegnati che nessuno sta più lavorando.
    Contare i soli 'open' è ciò che teneva chiuso il cerchio di O-164: il
    bridge sveglia il Capitano solo se questo numero è > 0, il Capitano è
    l'unico che esegue `list-open`, e `list-open` è dove i ticket orfani
    rientrano — con quattro ticket 'assigned' il numero era 0, quindi nessuno
    veniva svegliato e nessuno li recuperava. Mai più di quanto è vero: un
    ticket assegnato a un agente vivo e dentro il tempo NON si conta, perché
    qualcuno ci sta lavorando davvero.

    Resta READ-ONLY: il monitor lo chiama a ripetizione e non deve cambiare lo
    stato del team. A rimettere in coda è `list-open`, che il Capitano esegue.
    """
    n = conn.execute(
        "SELECT COUNT(*) FROM position_tickets WHERE status = 'open'"
    ).fetchone()[0]
    print(n + len(stale_assignments(conn, live)))


def assign(conn, ticket_id: int, agent: str, live=None) -> None:
    # Assegnare a una sessione che non esiste è come non assegnare, ma senza
    # errori: è così che sono nati i due ticket orfani di O-164. Non blocca —
    # `live` può essere `None` (liveness non stabilibile) e un Capitano fermato
    # da un falso negativo sarebbe peggio del difetto — ma lo dice.
    if live is not None and agent.strip().upper() not in live:
        print(f"⚠ {agent} has no live session: the ticket would sit there "
              f"unnoticed until list-open reclaims it.", file=sys.stderr)
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
    o.add_argument("--attachment", help="path returned by artifact.py upload")
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
                new_id = open_ticket(conn, args.position_id, args.text, args.kind,
                                     args.attachment)
            except (ValueError, LookupError) as e:
                print(f"✗ {e}", file=sys.stderr)
                sys.exit(1)
            print(f"✓ ticket #{new_id} opened for position #{args.position_id} "
                  f"(status 'open', queued for the Captain)")
        elif args.cmd == "list-open":
            list_open(conn, live_agents())
        elif args.cmd == "count-open":
            count_open(conn, live_agents())
        elif args.cmd == "assign":
            assign(conn, args.id, args.agent, live_agents())
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
