#!/usr/bin/env python3
"""throttle.py — sleep tracciato per agenti del team.

Ogni agente del team, quando deve mettere una pausa di throttle (regolare
il proprio ritmo per non sforare il rate budget), invoca questa skill
INVECE di `sleep N` nudo. Il bash wrapper `jht-throttle` semplifica la
chiamata.

Lo scopo è doppio:
  1. AVERE LOG: sappiamo *chi* si è messo in pausa, *quando*, *per quanto*.
     Senza questo, le pause vivono solo nei prompt e non sono osservabili.
  2. AVERE UN PUNTO DI INDIREZIONE: il Capitano calibra il throttle per
     ogni agente via throttle-config.json — la skill legge da lì se
     l'agente non passa esplicitamente `seconds`. Così il Capitano cambia
     1 file e tutti gli agenti applicano il nuovo valore al prossimo
     ciclo, senza dover ricevere 5 messaggi tmux.

NB: questo NON è un guard hard — un agente può sempre chiamare `sleep N`
direttamente. Il valore vero della skill è il logging + il routing al
config centralizzato.

Uso:
  python3 throttle.py [seconds] --agent <name> [--reason "..."]

  - Se `seconds` è omesso, viene letto da throttle-config.json
    (chiave per agente, fallback "default", fallback 0 = no-op).
  - Se `seconds=0` (esplicito o da config), la skill ritorna subito
    senza loggare (niente rumore per agenti in standby).

Eventi loggati (jsonl):
  - `event=start` scritto PRIMA dello sleep (visibilità "sta dormendo").
  - `event=end`   scritto DOPO lo sleep, con `actual_sleep_sec` reale e
                  `interrupted` se l'agente non ha aspettato fino in fondo.
  Lo stesso `id` lega start/end della stessa pausa. Il chart mostra anche
  start orfani (interrupted sintetico) per rendere visibili kill SIGKILL.
"""
import argparse
import json
import os
import signal
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
    ap.add_argument("seconds", type=float, nargs="?", default=None,
                    help="durata pausa in secondi (se omesso, legge throttle-config)")
    ap.add_argument("--agent", required=True, help="nome agente (es. scout-1)")
    ap.add_argument("--reason", default=None, help="motivo opzionale")
    args = ap.parse_args()

    # Risoluzione del valore: argomento esplicito > config > 0.
    config_used = False
    if args.seconds is None:
        # Import locale: il config script vive accanto a noi, e l'import
        # globale non ha senso se il caller passa esplicitamente seconds.
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            import importlib  # noqa: PLC0415
            tcfg = importlib.import_module("throttle-config".replace("-", "_"))
        except ImportError:
            # Fallback: import via spec se il modulo ha trattini nel filename
            import importlib.util  # noqa: PLC0415
            spec = importlib.util.spec_from_file_location(
                "throttle_config", Path(__file__).parent / "throttle-config.py"
            )
            if spec is None or spec.loader is None:
                print("error: cannot load throttle-config.py", file=sys.stderr)
                return 1
            tcfg = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(tcfg)
        requested = float(tcfg.get_agent(args.agent))
        config_used = True
    else:
        requested = float(args.seconds)
        if not (requested == requested):  # NaN check
            print("error: seconds must be a number", file=sys.stderr)
            return 1

    # Fast path: no-op se 0. Niente sleep, niente log — un agente in
    # standby non deve riempire il jsonl di eventi vuoti.
    if requested <= 0:
        return 0

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
        "source": "config" if config_used else "explicit",
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

    # SIGTERM handler: il CLI Kimi/Claude killa il subprocess via SIGTERM
    # quando l'agente passa a un nuovo tool prima della fine dello sleep.
    # Senza handler Python termina senza scrivere il record `end` →
    # start orfano nel jsonl, throttle invisibile nel chart. Lo rerouting
    # a KeyboardInterrupt riusa il path interrupted=True già esistente.
    def _on_signal(signum, frame):  # noqa: ARG001
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGHUP, _on_signal)

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
