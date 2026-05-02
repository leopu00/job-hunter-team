#!/usr/bin/env python3
"""throttle.py — sleep tracciato per agenti del team.

Ogni agente del team, quando deve mettere una pausa di throttle (regolare
il proprio ritmo per non sforare il rate budget), invoca questa skill
INVECE di `sleep N` nudo. Il bash wrapper `jht-throttle` semplifica la
chiamata.

Lo scopo è doppio:
  1. AVERE LOG: sappiamo *chi* si è messo in pausa, *quando*, *per quanto*.
     Senza questo, le pause vivono solo nei prompt e non sono osservabili.
  2. AVERE UN PUNTO DI INDIREZIONE: in futuro qui possiamo applicare
     multiplier per-agente (es. scout=2x, sentinella=0.5x) o leggere
     un profilo modificabile a runtime dal capitano. V1 = passthrough.

NB: questo NON è un guard hard — un agente può sempre chiamare `sleep N`
direttamente. Il valore vero della skill è il logging + la convenzione.

Uso:
  python3 throttle.py --agent <name> <seconds> [--reason "..."]

Eventi loggati (jsonl):
  - `event=start` scritto PRIMA dello sleep (visibilità "sta dormendo").
  - `event=end`   scritto DOPO lo sleep, con `actual_sleep_sec` reale e
                  `interrupted` se l'agente non ha aspettato fino in fondo.
  Lo stesso `id` lega start/end della stessa pausa. Solo gli `end`
  contano per i chart: vediamo le pause *davvero completate*, così se un
  agente esegue il comando in background e lo killa, il chart non mente.
"""
import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LOGS_DIR = JHT_HOME / "logs"
EVENTS_FILE = LOGS_DIR / "throttle-events.jsonl"

# Floor & ceiling: i prompt sono human-written, una pausa di 0 o di 1h sono
# probabilmente errori di battitura — meglio rifiutare/clampare che dormire
# arbitrariamente. Floor 1s permette comunque pause brevi inter-iter.
MIN_SLEEP = 1
MAX_SLEEP = 3600  # 1h hard cap


def _append_event(payload: dict) -> None:
    """Append atomico al jsonl. Se la dir manca, la crea (boot pulito)."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, separators=(",", ":")) + "\n"
    # 'a' è già atomico per write < PIPE_BUF (4 KB su Linux), che è il
    # nostro caso (record ~200 B). Niente lockfile necessario.
    with EVENTS_FILE.open("a", encoding="utf-8") as f:
        f.write(line)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Sleep tracciato per agenti del team."
    )
    ap.add_argument("seconds", type=float, help="durata pausa in secondi")
    ap.add_argument("--agent", required=True, help="nome agente (es. scout-1)")
    ap.add_argument("--reason", default=None, help="motivo opzionale")
    args = ap.parse_args()

    requested = float(args.seconds)
    if not (requested == requested):  # NaN check
        print("error: seconds must be a number", file=sys.stderr)
        return 1
    applied = max(MIN_SLEEP, min(MAX_SLEEP, requested))

    pause_id = uuid.uuid4().hex[:12]
    started_unix = time.time()
    started_iso = datetime.fromtimestamp(started_unix, tz=timezone.utc).isoformat()

    start_payload = {
        "event": "start",
        "id": pause_id,
        "ts": started_iso,
        "ts_unix": started_unix,
        "agent": args.agent,
        "requested_sec": round(requested, 2),
        "applied_sec": round(applied, 2),
        "reason": args.reason,
    }
    try:
        _append_event(start_payload)
    except OSError as e:
        # Se non riusciamo a loggare, pause comunque: non vogliamo che un
        # errore di filesystem blocchi un agente in piena attività.
        print(f"warn: failed to log start event: {e}", file=sys.stderr)

    # stderr per non sporcare stdout di un agente che potrebbe pipare
    print(
        f"[throttle] {args.agent} sleeping {applied:.0f}s"
        + (f" — {args.reason}" if args.reason else ""),
        file=sys.stderr,
    )

    interrupted = False
    try:
        time.sleep(applied)
    except KeyboardInterrupt:
        interrupted = True

    ended_unix = time.time()
    ended_iso = datetime.fromtimestamp(ended_unix, tz=timezone.utc).isoformat()
    actual = max(0.0, ended_unix - started_unix)

    end_payload = {
        "event": "end",
        "id": pause_id,
        "ts": ended_iso,
        "ts_unix": ended_unix,
        "agent": args.agent,
        "requested_sec": round(requested, 2),
        "applied_sec": round(applied, 2),
        "actual_sleep_sec": round(actual, 2),
        "interrupted": interrupted,
        "reason": args.reason,
    }
    try:
        _append_event(end_payload)
    except OSError as e:
        print(f"warn: failed to log end event: {e}", file=sys.stderr)

    return 130 if interrupted else 0


if __name__ == "__main__":
    sys.exit(main())
