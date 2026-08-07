#!/usr/bin/env python3
"""user_exclude.py — let the user exclude or restore a position.

Exclusion is a USER decision, not a team outcome. It sets
`status = 'excluded'`, which removes the position from agent queues so no one
spends more tokens rechecking a job the user has rejected.

The action is reversible: `user_excluded_prev_status` stores the previous
state and `restore` puts it back.

    python3 user_exclude.py exclude 42 --reason not_interested
    python3 user_exclude.py exclude 42 --reason other --note "wrong location"
    python3 user_exclude.py restore 42

This file exposes the same capability as the web API to the CLI and agents.
It follows the `write_request.py` pattern used for Telegram's `/cv <id>`.

Keep the Python and TypeScript implementations aligned when changing rules.

Output: one JSON row on stdout; exit 0 on success or 1 on failure.
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
        return {"ok": False, "error": f"invalid reason: {reason}",
                "valid_reasons": list(VALID_REASONS)}
    # 'other' senza spiegazione è un'esclusione che fra un mese non saprai
    # rileggere. La UI lo impone già; qui vale lo stesso.
    if reason == "other" and not (note or "").strip():
        return {"ok": False, "error": "reason 'other' requires --note"}

    conn = get_db()
    ensure_schema(conn)
    try:
        row = conn.execute(
            "SELECT id, status, user_excluded_prev_status FROM positions WHERE id = ?",
            (position_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"position #{position_id} not found"}

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
            return {"ok": False, "error": f"position #{position_id} not found"}

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

    ex = sub.add_parser("exclude", help="exclude a position")
    ex.add_argument("position_id", type=int)
    ex.add_argument("--reason", required=True, choices=list(VALID_REASONS))
    ex.add_argument("--note", help="required with --reason other")

    re_ = sub.add_parser("restore", help="restore the position to its previous status")
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
