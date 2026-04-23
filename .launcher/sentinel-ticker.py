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

Intervallo: rileggiamo `sentinella_tick_minutes` da $JHT_HOME/jht.config.json
ogni ciclo di sleep (risoluzione ~15s), quindi cambiando il valore dalla UI
il ticker si adegua senza bisogno di restart. Fallback: $JHT_TICK_INTERVAL
env var (usato come bootstrap iniziale se il config non esiste), poi 5.

Uso:
  python3 sentinel-ticker.py             # legge dinamicamente dal config
  python3 sentinel-ticker.py 10          # forza 10 min, ignora config

Config:
  JHT_TICK_INTERVAL    bootstrap (min) se jht.config.json non ha il campo
  JHT_SENTINEL_SESSION sessione tmux target (default SENTINELLA)
  JHT_HOME             dir del config (default ~/.jht)
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


SESSION = os.environ.get("JHT_SENTINEL_SESSION", "SENTINELLA")
BOOTSTRAP_INTERVAL = int(os.environ.get("JHT_TICK_INTERVAL", "5"))
CONFIG_PATH = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht"))) / "jht.config.json"

# Granularità del poll del config durante lo sleep fra tick: un cambio
# da UI diventa effettivo entro questa finestra (es. se sleep era 10 min
# e l'utente scende a 2 min, il tick successivo parte entro ~15s).
POLL_SECONDS = 15
MIN_INTERVAL = 1
MAX_INTERVAL = 60


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


def read_config_minutes(bootstrap: int) -> int:
    """Legge sentinella_tick_minutes dal jht.config.json con range-check."""
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as fh:
            cfg = json.load(fh)
        raw = cfg.get("sentinella_tick_minutes")
        if isinstance(raw, (int, float)):
            n = int(round(raw))
            if MIN_INTERVAL <= n <= MAX_INTERVAL:
                return n
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    # Fallback al valore iniziale
    return max(MIN_INTERVAL, min(MAX_INTERVAL, bootstrap))


def sleep_with_config_poll(target_minutes: int, bootstrap: int) -> int:
    """
    Dorme fino a target_minutes * 60 secondi, ma ogni POLL_SECONDS rilegge
    il config: se il valore e' cambiato e il tempo gia' trascorso supera
    il nuovo intervallo, esce subito. Ritorna il numero di minuti
    effettivamente usati come intervallo (per log).
    """
    total_sec = target_minutes * 60
    elapsed = 0
    current = target_minutes
    while elapsed < total_sec:
        time.sleep(min(POLL_SECONDS, total_sec - elapsed))
        elapsed += POLL_SECONDS
        fresh = read_config_minutes(bootstrap)
        if fresh != current:
            # Nuovo intervallo: se gia' oltre, esci subito; altrimenti
            # aggiorna target e continua.
            new_total = fresh * 60
            if elapsed >= new_total:
                return fresh
            total_sec = new_total
            current = fresh
    return current


def main():
    # Override da argv per test rapidi: se passato, disabilita il poll
    # dinamico e usa il valore fisso.
    fixed_arg = None
    if len(sys.argv) > 1:
        try:
            fixed_arg = int(sys.argv[1])
            fixed_arg = max(MIN_INTERVAL, min(MAX_INTERVAL, fixed_arg))
        except ValueError:
            print(f"[sentinel-ticker] arg non numerico '{sys.argv[1]}', uso config")

    print(f"[sentinel-ticker] target: {SESSION}")
    if fixed_arg is not None:
        print(f"[sentinel-ticker] intervallo fisso (argv): {fixed_arg} min")
    else:
        print(f"[sentinel-ticker] intervallo dinamico da {CONFIG_PATH} (bootstrap: {BOOTSTRAP_INTERVAL} min)")

    while True:
        if not session_exists(SESSION):
            print(f"[sentinel-ticker] {SESSION} non attiva — attendo 30s...")
            time.sleep(30)
            continue

        interval_min = fixed_arg if fixed_arg is not None else read_config_minutes(BOOTSTRAP_INTERVAL)

        now = datetime.now().strftime("%H:%M:%S")
        msg = (
            f"[TICK {now}] Controlla il consumo adesso: "
            f"legge il provider da jht.config.json, lancia /status (codex) "
            f"o /usage (claude/kimi) sul worker SENTINELLA-WORKER, parsa l'output, "
            f"aggiorna log + JSONL e alerta il Capitano se soglia superata."
        )
        ok = send_tick(SESSION, msg)
        status = "OK" if ok else "ERRORE"
        print(f"[sentinel-ticker] {now} — tick inviato ({interval_min}m): {status}")

        if fixed_arg is not None:
            time.sleep(fixed_arg * 60)
        else:
            sleep_with_config_poll(interval_min, BOOTSTRAP_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[sentinel-ticker] interrotto.")
        sys.exit(0)
