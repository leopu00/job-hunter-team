#!/usr/bin/env python3
"""feedback_record.py — registra il giudizio dell'utente su una posizione.

L'altra metà di `feedback_query.py`: quella legge like/dislike/hide/star, qui
si scrivono. Il record vive solo su Supabase (`position_feedback`), non in
SQLite, quindi questa è l'unica strada e passa dalla corsia cloud.

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

**Un cloud spento qui è un ERRORE, non un "nessun segnale".** È la differenza
che conta fra questo file e `feedback_query.py`: la lettura degrada in
silenzio perché lo Scorer deve poter continuare senza feedback, la scrittura
no. Un comando che dice "fatto" senza aver registrato niente lascia l'utente
convinto di aver espresso un giudizio che non esiste — sarebbe il peggiore dei
due mondi, peggio del comando che non c'era.

Output: una riga JSON su stdout; exit 0 se registrato, 1 altrimenti.
  {"ok": true, "legacy_id": "12345", "action": "like", "recorded_at": "..."}
  {"ok": false, "error": "cloud-disabled", ...}
"""
import argparse
import json
import os
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

    safe_id = urllib.parse.quote(str(legacy_id), safe="")
    ok, payload = api_request("POST", f"/api/positions/{safe_id}/feedback", body)
    if not ok:
        # Nessun ripiego silenzioso: se il giudizio non è arrivato al cloud,
        # non è stato registrato da nessuna parte.
        return {"ok": False, "error": str(payload), "legacy_id": str(legacy_id),
                "action": action, "recorded": False}
    saved = (payload or {}).get("feedback") or {}
    return {
        "ok": True,
        "legacy_id": str(legacy_id),
        "action": saved.get("action", action),
        "score": saved.get("score", score),
        "direction": saved.get("direction", direction),
        "recorded_at": saved.get("created_at"),
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
