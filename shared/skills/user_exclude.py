#!/usr/bin/env python3
"""user_exclude.py — l'utente esclude (o ripristina) una posizione.

L'esclusione è una DECISIONE dell'utente, non un esito del team: "questa non
mi interessa, non spenderci altri token". Effetto: `status = 'excluded'`, che
fa uscire la posizione dalle code agenti (`next-for-recheck`,
`next-for-categorize` e compagnia filtrano già sullo stato) — così nessuno
ri-verifica la liveness di un annuncio che l'utente ha già scartato.

Reversibile per costruzione: `user_excluded_prev_status` conserva lo stato
precedente, e `restore` lo rimette dov'era.

    python3 user_exclude.py exclude 42 --reason not_interested
    python3 user_exclude.py exclude 42 --reason other --note "sede sbagliata"
    python3 user_exclude.py restore 42

Perché questo file esiste, dato che l'API web fa già la stessa cosa: la logica
viveva SOLO dentro `web/app/api/positions/[legacyId]/user-exclude/route.ts`,
quindi era raggiungibile solo da un browser. Il CLI — e gli agenti LLM che lo
guidano — non avevano modo di escludere una posizione. Lo stesso pattern di
`write_request.py`, che è la fonte per `/cv <id>` di Telegram mentre il web ne
tiene una copia TS inline.

⚠️ Le due implementazioni vanno tenute allineate a mano: se cambi le regole
qui, cambia anche la route TS (e viceversa). Nessun test le confronta ancora —
vedi [JHT-CLI-AGENT-PARITY] nel BACKLOG.

Output: una riga JSON su stdout, exit 0 se ok / 1 se no.
  {"ok": true, "id": 42, "action": "exclude", "status": "excluded",
   "previous_status": "scored", "reason": "not_interested", "note": null}
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema

# Stesso insieme della route TS. 'already_applied' resta accettato per le righe
# storiche: la UI dal 22/07 offre 'mismatch' al suo posto, ma i dati vecchi ci
# sono ancora e rifiutarli qui renderebbe impossibile ri-escludere una
# posizione con la causa che ha già.
VALID_REASONS = (
    "closed",           # Chiusa / non più attiva
    "not_interested",   # Non mi interessa
    "mismatch",         # Non in linea col profilo
    "already_applied",  # Già candidato / gestita altrove (legacy)
    "company",          # Azienda non desiderata
    "conditions",       # Condizioni inadatte (stipendio/sede)
    "other",            # Altro — richiede --note
)


def exclude(position_id: int, reason: str, note: str | None = None) -> dict:
    if reason not in VALID_REASONS:
        return {"ok": False, "error": f"causa non valida: {reason}",
                "valid_reasons": list(VALID_REASONS)}
    # 'other' senza spiegazione è un'esclusione che fra un mese non saprai
    # rileggere. La UI lo impone già; qui vale lo stesso.
    if reason == "other" and not (note or "").strip():
        return {"ok": False, "error": "la causa 'other' richiede --note"}

    conn = get_db()
    ensure_schema(conn)
    try:
        row = conn.execute(
            "SELECT id, status, user_excluded_prev_status FROM positions WHERE id = ?",
            (position_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"posizione #{position_id} non trovata"}

        # Se è GIÀ esclusa, non sovrascrivere prev_status con 'excluded':
        # perderebbe per sempre lo stato reale da cui ripristinare.
        prev = (row["user_excluded_prev_status"] or "scored") \
            if row["status"] == "excluded" else row["status"]

        conn.execute(
            """UPDATE positions
                  SET status = 'excluded',
                      user_excluded_reason = ?,
                      user_excluded_note = ?,
                      user_excluded_at = CURRENT_TIMESTAMP,
                      user_excluded_prev_status = ?,
                      last_actor = 'user'
                WHERE id = ?""",
            (reason, note, prev, position_id),
        )
        # Event-log solo su transizione VERA: ri-escludere una posizione già
        # esclusa non è un movimento e non deve comparire in "Attività recente".
        if row["status"] != "excluded":
            conn.execute(
                """INSERT INTO position_state_transitions
                     (position_id, from_state, to_state, by_agent, notes)
                   VALUES (?, ?, 'excluded', 'user', ?)""",
                (position_id, row["status"], reason),
            )
        conn.commit()
        return {"ok": True, "id": position_id, "action": "exclude",
                "status": "excluded", "previous_status": prev,
                "reason": reason, "note": note}
    finally:
        conn.close()


def restore(position_id: int) -> dict:
    conn = get_db()
    ensure_schema(conn)
    try:
        row = conn.execute(
            "SELECT id, status, user_excluded_prev_status FROM positions WHERE id = ?",
            (position_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"posizione #{position_id} non trovata"}

        target = row["user_excluded_prev_status"] or "scored"
        conn.execute(
            """UPDATE positions
                  SET status = ?,
                      user_excluded_reason = NULL,
                      user_excluded_note = NULL,
                      user_excluded_at = NULL,
                      user_excluded_prev_status = NULL,
                      last_actor = 'user'
                WHERE id = ?""",
            (target, position_id),
        )
        if row["status"] == "excluded":
            conn.execute(
                """INSERT INTO position_state_transitions
                     (position_id, from_state, to_state, by_agent, notes)
                   VALUES (?, 'excluded', ?, 'user', NULL)""",
                (position_id, target),
            )
        conn.commit()
        return {"ok": True, "id": position_id, "action": "restore",
                "status": target, "previous_status": row["status"]}
    finally:
        conn.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    ex = sub.add_parser("exclude", help="escludi una posizione")
    ex.add_argument("position_id", type=int)
    ex.add_argument("--reason", required=True, choices=list(VALID_REASONS))
    ex.add_argument("--note", help="obbligatoria con --reason other")

    re_ = sub.add_parser("restore", help="riporta la posizione allo stato precedente")
    re_.add_argument("position_id", type=int)

    args = p.parse_args()
    try:
        if args.cmd == "exclude":
            result = exclude(args.position_id, args.reason, args.note)
        else:
            result = restore(args.position_id)
    except Exception as e:  # pragma: no cover — rete di sicurezza
        result = {"ok": False, "error": str(e), "status_code": "DB_ERROR"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
