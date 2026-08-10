#!/usr/bin/env python3
"""feedback_record.py — registra il giudizio dell'utente su una posizione.

L'altra metà di `feedback_query.py`: quella legge like/dislike/hide/star, qui
si scrivono. Il record nasce in SQLite (`position_feedback`) e il cloud è un
riflesso: local-first, come ogni altra scrittura del prodotto.

    python3 feedback_record.py set 12345 like
    python3 feedback_record.py set 12345 dislike --reason "troppo senior"
    python3 feedback_record.py set 12345 star --score 5 --direction more_like_this
    python3 feedback_record.py set 12345 clear

**Fino al 2026-08-10 non si poteva fare.** La route
`web/app/api/positions/[legacyId]/feedback/route.ts` rispondeva 403 a
chiunque non arrivasse da una sessione browser, e un token di dispositivo —
quello che hanno container e CLI — era rifiutato per scelta. Il vincolo è
caduto su decisione esplicita dell'operatore: doveva impedire le azioni NON
richieste, non impedire all'utente di farsi aiutare da `jht`. Il perché per
esteso sta nel commento in cima a quella POST.

**Un cloud spento non è più un errore (O-15).** Lo era finché il record
esisteva solo su Supabase: allora "cloud spento" voleva dire davvero "non
registrato da nessuna parte", e dire "fatto" sarebbe stata una bugia. Ora il
giudizio è già salvo in SQLite quando il cloud viene interpellato, quindi un
cloud irraggiungibile è un `cloud_synced: false` — un dettaglio sulla
propagazione, non un fallimento della registrazione.

Quello che NON è cambiato è il patto sottostante: non si dice "fatto" senza
aver scritto. Se fallisce la scrittura LOCALE il comando fallisce, ed è la
sola condizione in cui lo fa.

Output: una riga JSON su stdout; exit 0 se registrato, 1 altrimenti.
  {"ok": true, "legacy_id": "12345", "action": "like", "recorded_at": "...",
   "source": "local", "cloud_synced": false}
  {"ok": false, "error": "position 12345 not found in the local database", ...}
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))

from feedback_query import api_request  # noqa: E402  (dopo il sys.path)

# Lo stesso elenco di VALID_ACTIONS nella route. 'clear' non cancella niente:
# è un evento come gli altri e l'ultimo prevale, quindi «ritiro il voto» resta
# leggibile nella storia invece di sparire da essa (mig 059).
VALID_ACTIONS = ("like", "dislike", "hide", "star", "clear")
VALID_DIRECTIONS = ("more_like_this", "less_like_this")
MAX_REASON = 500
MAX_COMMENT = 2000

# Perché rivalidare qui, se la route valida già: il messaggio. Un 400 del
# server arriva come `http-400: {"error":...}`, che un agente deve interpretare;
# un rifiuto locale dice subito cosa cambiare, e non consuma una chiamata di
# rete per scoprire che 7 non è un punteggio da 1 a 5.
def validate(action: str, reason, comment, score, direction) -> str:
    if action not in VALID_ACTIONS:
        return f"invalid action: {action} (one of: {', '.join(VALID_ACTIONS)})"
    if reason is not None and len(reason) > MAX_REASON:
        return f"reason longer than {MAX_REASON} characters"
    if comment is not None and len(comment) > MAX_COMMENT:
        return f"comment longer than {MAX_COMMENT} characters"
    if score is not None and not (1 <= score <= 5):
        return "score must be an integer between 1 and 5"
    if direction is not None and direction not in VALID_DIRECTIONS:
        return f"invalid direction: {direction} (one of: {', '.join(VALID_DIRECTIONS)})"
    return ""



def _record_local(legacy_id, action, reason, comment, score, direction) -> dict:
    """Scrive il giudizio nel jobs.db. È qui che il record esiste davvero.

    Un jobs.db più vecchio del codice non ha ancora `position_feedback`: in
    quel caso si crea la tabella al volo con la stessa migrazione idempotente
    dello schema, invece di far fallire il comando. Fra l'aggiornamento del
    CLI e il primo giro delle migrazioni c'è una finestra reale, ed è
    esattamente lì che un utente perde un'azione senza capire perché (O-16).
    """
    try:
        import _db
    except ImportError as exc:  # pragma: no cover - ambiente senza skill
        return {"ok": False, "error": f"local database unavailable: {exc}"}

    try:
        conn = _db.get_db()
    except Exception as exc:
        return {"ok": False, "error": f"cannot open the local database: {exc}"}

    try:
        conn.row_factory = sqlite3.Row
        # Un DB senza `positions` non è un jobs.db del prodotto: è un file
        # vuoto creato di passaggio. Dirlo con parole proprie, invece di
        # lasciar emergere un "no such table" che manda a cercare un difetto.
        if not _db._table_exists(conn, "positions"):
            return {"ok": False,
                    "error": "local database not initialised (start the team once)"}
        if not _db._table_exists(conn, "position_feedback"):
            _db._migrate_position_feedback(conn)
        row = conn.execute(
            "SELECT id FROM positions WHERE id = ?", (int(legacy_id),)
        ).fetchone() if str(legacy_id).lstrip("-").isdigit() else None
        if row is None:
            return {"ok": False,
                    "error": f"position {legacy_id} not found in the local database"}
        cur = conn.execute(
            """INSERT INTO position_feedback
                 (position_id, action, reason, comment, score, direction)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (int(legacy_id), action, reason, comment, score, direction),
        )
        conn.commit()
        created = conn.execute(
            "SELECT created_at FROM position_feedback WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return {"ok": True, "id": cur.lastrowid,
                "created_at": created["created_at"] if created else None}
    except Exception as exc:
        return {"ok": False, "error": f"local write failed: {exc}"}
    finally:
        conn.close()


def record(legacy_id: str, action: str, reason=None, comment=None,
           score=None, direction=None) -> dict:
    problem = validate(action, reason, comment, score, direction)
    if problem:
        return {"ok": False, "error": problem, "legacy_id": str(legacy_id)}

    body = {"action": action}
    # Solo i campi valorizzati: mandare `null` espliciti sovrascriverebbe con
    # NULL colonne che l'utente non ha toccato.
    if reason is not None:
        body["reason"] = reason
    if comment is not None:
        body["comment"] = comment
    if score is not None:
        body["score"] = score
    if direction is not None:
        body["direction"] = direction

    # ── 1. Locale, che è dove il giudizio ESISTE ────────────────────────
    local = _record_local(legacy_id, action, reason, comment, score, direction)
    if not local.get("ok"):
        # L'unico fallimento che ferma il comando: qui il giudizio non è
        # stato scritto da nessuna parte, e dire "fatto" sarebbe una bugia.
        return {"ok": False, "error": local.get("error"),
                "legacy_id": str(legacy_id), "action": action,
                "recorded": False}

    # ── 2. Cloud, che è un riflesso ─────────────────────────────────────
    # Il suo esito diventa `cloud_synced`, MAI l'esito del comando: il
    # giudizio è già salvo, e far fallire qui lo nasconderebbe all'utente
    # esattamente come prima di O-15.
    safe_id = urllib.parse.quote(str(legacy_id), safe="")
    ok, payload = api_request("POST", f"/api/positions/{safe_id}/feedback", body)
    saved = (payload or {}).get("feedback") or {} if ok else {}
    return {
        "ok": True,
        "legacy_id": str(legacy_id),
        "action": saved.get("action", action),
        "score": saved.get("score", score),
        "direction": saved.get("direction", direction),
        "recorded_at": saved.get("created_at") or local.get("created_at"),
        "source": "local",
        "cloud_synced": bool(ok),
        # Perché il cloud non ha preso: 'cloud-disabled' è una scelta
        # dell'utente, un errore di rete è un guasto passeggero. Chi legge
        # deve poterli distinguere senza indovinare.
        "cloud_error": None if ok else str(payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Record the user's judgement on a position.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_set = sub.add_parser("set", help="record a judgement (the latest one wins)")
    p_set.add_argument("legacy_id", help="positions.legacy_id (TEXT)")
    p_set.add_argument("action", choices=VALID_ACTIONS)
    p_set.add_argument("--reason", help=f"short reason (max {MAX_REASON} chars)")
    p_set.add_argument("--comment", help=f"free text (max {MAX_COMMENT} chars)")
    p_set.add_argument("--score", type=int, help="1-5")
    p_set.add_argument("--direction", choices=VALID_DIRECTIONS,
                       help="tell the Scout to look for more, or fewer, like this")

    args = parser.parse_args()
    out = record(args.legacy_id, args.action, reason=args.reason,
                 comment=args.comment, score=args.score, direction=args.direction)
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
