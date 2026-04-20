#!/usr/bin/env python3
"""
Sentinel Ticker — Job Hunter Team

Heartbeat esterno per la Sentinella: ogni N minuti invia un messaggio
[TICK HH:MM:SS] alla sessione tmux SENTINELLA. La Sentinella sta in
attesa silenziosa (niente loop interno) e al tick esegue /status
(codex) o /usage (claude/kimi) sul worker, parsa, logga, alerta.

Perché ticker esterno (pattern ereditato dal dev-team Vigil):
  - Sentinella non consuma token in idle (non fa polling da sola)
  - Intervallo configurabile senza toccare il prompt dell'agente
  - Separazione responsabilità: ticker = "sveglia", sentinella = "check"

Uso:
  python3 sentinel-ticker.py             # default 5 min (oppure $JHT_TICK_INTERVAL)
  python3 sentinel-ticker.py 10          # ogni 10 min

Config:
  JHT_TICK_INTERVAL   intervallo in minuti (default 5)
  JHT_SENTINEL_SESSION sessione tmux target (default SENTINELLA)
"""

import os
import subprocess
import sys
import time
from datetime import datetime


SESSION = os.environ.get("JHT_SENTINEL_SESSION", "SENTINELLA")
DEFAULT_INTERVAL = int(os.environ.get("JHT_TICK_INTERVAL", "5"))


def session_exists(session: str) -> bool:
    result = subprocess.run(
        ["tmux", "has-session", "-t", session],
        capture_output=True,
    )
    return result.returncode == 0


def send_tick(session: str, message: str) -> bool:
    """Usa jht-tmux-send (atomico: testo + Enter con pausa di render)."""
    result = subprocess.run(
        ["jht-tmux-send", session, message],
        capture_output=True,
        timeout=10,
    )
    return result.returncode == 0


def main():
    interval_min = DEFAULT_INTERVAL
    if len(sys.argv) > 1:
        try:
            interval_min = int(sys.argv[1])
        except ValueError:
            print(f"[sentinel-ticker] arg non numerico '{sys.argv[1]}', uso default {DEFAULT_INTERVAL}m")

    print(f"[sentinel-ticker] intervallo: {interval_min} min")
    print(f"[sentinel-ticker] target: {SESSION}")

    while True:
        if not session_exists(SESSION):
            print(f"[sentinel-ticker] {SESSION} non attiva — attendo 30s...")
            time.sleep(30)
            continue

        now = datetime.now().strftime("%H:%M:%S")
        msg = (
            f"[TICK {now}] Controlla il consumo adesso: "
            f"legge il provider da jht.config.json, lancia /status (codex) "
            f"o /usage (claude/kimi) sul worker SENTINELLA-WORKER, parsa l'output, "
            f"aggiorna log + JSONL e alerta il Capitano se soglia superata."
        )
        ok = send_tick(SESSION, msg)
        status = "OK" if ok else "ERRORE"
        print(f"[sentinel-ticker] {now} — tick inviato: {status}")

        time.sleep(interval_min * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[sentinel-ticker] interrotto.")
        sys.exit(0)
