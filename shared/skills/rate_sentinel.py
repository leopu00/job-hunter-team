#!/usr/bin/env python3
"""Sentinella Rate Limit — Job Hunter Team

Monitora il consumo degli agenti Claude e avvisa il Capitano
quando si approssima il rate limit. Funziona con Claude Max
(subscription) monitorando l'attivita' delle sessioni tmux.

Uso:
  python3 rate_sentinel.py                    # Avvia monitoraggio continuo
  python3 rate_sentinel.py --interval 30      # Check ogni 30 secondi
  python3 rate_sentinel.py --status           # Mostra stato attuale
  python3 rate_sentinel.py --reset            # Reset contatori

Funzionamento:
  1. Ogni N secondi cattura l'output tmux di ogni agente
  2. Conta i messaggi Claude (risposte) tramite pattern matching
  3. Calcola velocita' (msg/min), proiezione giornaliera, % consumo
  4. Avvisa il Capitano via tmux se WARNING (70%) o CRITICAL (90%)
  5. Logga tutto in shared/data/rate_sentinel.log

Configurazione (variabili d'ambiente):
  JHT_DAILY_LIMIT    — limite messaggi giornaliero (default: 1800)
  JHT_HOURLY_LIMIT   — limite messaggi orario (default: 150)
  JHT_CHECK_INTERVAL — secondi tra i check (default: 60)
  JHT_CAPTAIN_SESSION — nome sessione tmux capitano (default: ALFA)
"""

import subprocess
import json
import os
import sys
import time
import re
from datetime import datetime, timedelta
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────

DAILY_LIMIT = int(os.environ.get("JHT_DAILY_LIMIT", "1800"))
HOURLY_LIMIT = int(os.environ.get("JHT_HOURLY_LIMIT", "150"))
CHECK_INTERVAL = int(os.environ.get("JHT_CHECK_INTERVAL", "60"))
CAPTAIN_SESSION = os.environ.get("JHT_CAPTAIN_SESSION", "ALFA")

WARNING_PCT = 70
CRITICAL_PCT = 90

# DATA_DIR: prima $JHT_HOME/data/ (bind-mount persistente ~/.jht, fuori
# repo), poi fallback __file__/../data per esecuzioni ad-hoc fuori
# container. Stessa logica di _db.py (jobs.db). Senza questo, le scritture
# finivano in /app/shared/data/ che è bind-mount del repo → state file e
# log leakano come untracked files in git.
_jht_home = os.environ.get("JHT_HOME")
DATA_DIR = Path(_jht_home) / "data" if _jht_home else Path(__file__).parent.parent / "data"
STATE_FILE = DATA_DIR / "rate_sentinel_state.json"
LOG_FILE = DATA_DIR / "rate_sentinel.log"

# Pattern per rilevare risposte Claude nel tmux output
CLAUDE_PATTERNS = [
    r'╭─',               # Inizio risposta Claude Code
    r'⏺',               # Indicatore attivita' Claude
    r'Tool Use:',        # Tool call
    r'Co-Authored-By:',  # Commit fatto da Claude
]

# Prefissi sessioni agenti Job Hunter da monitorare
# Nomi reali: ALFA, SCOUT-1, SCOUT-2, ANALISTA-1, ANALISTA-2,
#   SCORER-1, SCRITTORE-1/2/3, CRITICO, SENTINELLA
# NON include le sessioni dev (JHT-BACKEND, JHT-FRONTEND, ecc.)
JH_AGENT_PREFIXES = [
    "ALFA",            # Capitano (coordinatore pipeline)
    "SCOUT",           # Scout (cerca posizioni)
    "ANALISTA",        # Analista (analizza job description)
    "SCORER",          # Scorer (calcola punteggio match)
    "SCRITTORE",       # Scrittore (scrive CV e cover letter)
    "CRITICO",         # Critico (revisione qualita')
    "SENTINELLA",      # Sentinella (rate limit monitor)
]
# Sessioni dev da ESCLUDERE dal monitoraggio
DEV_SESSIONS = {"JHT-BACKEND", "JHT-FRONTEND", "JHT-E2E", "JHT-QA", "JHT-INFRA", "JHT-COORD"}


# ── State management ────────────────────────────────────────────

def load_state():
    """Carica stato persistente."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {
        "start_time": datetime.now().isoformat(),
        "messages_total": 0,
        "messages_hourly": 0,
        "hourly_reset": datetime.now().isoformat(),
        "daily_reset": datetime.now().replace(hour=0, minute=0, second=0).isoformat(),
        "messages_daily": 0,
        "per_agent": {},
        "warnings_sent": 0,
        "last_warning": None,
        "last_line_counts": {},
    }


def save_state(state):
    """Salva stato su file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


def log(msg, level="INFO"):
    """Scrive nel log file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}\n"
    with open(LOG_FILE, "a") as f:
        f.write(line)
    if level in ("WARNING", "CRITICAL"):
        print(f"\033[1;33m{line.strip()}\033[0m" if level == "WARNING"
              else f"\033[1;31m{line.strip()}\033[0m")
    else:
        print(line.strip())


# ── tmux interaction ────────────────────────────────────────────

def get_tmux_sessions():
    """Lista sessioni tmux attive degli agenti Job Hunter (non dev)."""
    try:
        result = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return []
        active = [s.strip() for s in result.stdout.strip().split("\n") if s.strip()]
        # Filtra: solo sessioni che matchano i prefissi agenti JH, escludi dev
        matched = []
        for s in active:
            if s in DEV_SESSIONS:
                continue
            for prefix in JH_AGENT_PREFIXES:
                if s == prefix or s.startswith(prefix + "-"):
                    matched.append(s)
                    break
        return matched
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


def get_tmux_line_count(session_name):
    """Conta le righe totali nel pane tmux di una sessione."""
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return 0
        return len(result.stdout.strip().split("\n"))
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 0


def count_claude_activity(session_name, since_lines=0):
    """Conta attivita' Claude nel pane tmux da una certa riga in poi."""
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return 0
        lines = result.stdout.strip().split("\n")
        new_lines = lines[since_lines:] if since_lines < len(lines) else []
        count = 0
        for line in new_lines:
            for pattern in CLAUDE_PATTERNS:
                if re.search(pattern, line):
                    count += 1
                    break
        return count
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 0


def send_to_captain(message):
    """Invia messaggio al Capitano via tmux (due comandi separati)."""
    try:
        subprocess.run(
            ["tmux", "send-keys", "-t", CAPTAIN_SESSION, message],
            capture_output=True, timeout=5
        )
        subprocess.run(
            ["tmux", "send-keys", "-t", CAPTAIN_SESSION, "Enter"],
            capture_output=True, timeout=5
        )
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


# ── Core monitoring ─────────────────────────────────────────────

def check_and_reset_windows(state):
    """Reset contatori orari/giornalieri se necessario."""
    now = datetime.now()

    # Reset orario
    hourly_reset = datetime.fromisoformat(state["hourly_reset"])
    if now - hourly_reset >= timedelta(hours=1):
        state["messages_hourly"] = 0
        state["hourly_reset"] = now.isoformat()

    # Reset giornaliero
    daily_reset = datetime.fromisoformat(state["daily_reset"])
    if now - daily_reset >= timedelta(days=1):
        state["messages_daily"] = 0
        state["daily_reset"] = now.replace(hour=0, minute=0, second=0).isoformat()
        state["warnings_sent"] = 0
        log("Reset contatori giornalieri")

    return state


def monitor_cycle(state):
    """Esegui un ciclo di monitoraggio."""
    sessions = get_tmux_sessions()
    if not sessions:
        return state

    total_new = 0
    for session in sessions:
        last_count = state["last_line_counts"].get(session, 0)
        current_count = get_tmux_line_count(session)

        if current_count > last_count:
            new_activity = count_claude_activity(session, last_count)
            total_new += new_activity

            if session not in state["per_agent"]:
                state["per_agent"][session] = 0
            state["per_agent"][session] += new_activity

        state["last_line_counts"][session] = current_count

    # Aggiorna contatori
    state["messages_total"] += total_new
    state["messages_hourly"] += total_new
    state["messages_daily"] += total_new

    # Calcola metriche
    start_time = datetime.fromisoformat(state["start_time"])
    elapsed_min = max((datetime.now() - start_time).total_seconds() / 60, 1)
    rate_per_min = state["messages_total"] / elapsed_min

    hourly_pct = (state["messages_hourly"] / HOURLY_LIMIT * 100) if HOURLY_LIMIT else 0
    daily_pct = (state["messages_daily"] / DAILY_LIMIT * 100) if DAILY_LIMIT else 0

    # Proiezione: a questo ritmo, quando superiamo il limite?
    if rate_per_min > 0:
        remaining_daily = DAILY_LIMIT - state["messages_daily"]
        minutes_to_limit = remaining_daily / rate_per_min
        hours_to_limit = minutes_to_limit / 60
        eta_limit = datetime.now() + timedelta(minutes=minutes_to_limit)
    else:
        hours_to_limit = float('inf')
        eta_limit = None

    # Check thresholds e invia warning
    max_pct = max(hourly_pct, daily_pct)
    state = check_thresholds(state, max_pct, hourly_pct, daily_pct,
                             rate_per_min, hours_to_limit, eta_limit, sessions)

    return state


def check_thresholds(state, max_pct, hourly_pct, daily_pct,
                     rate_per_min, hours_to_limit, eta_limit, sessions):
    """Verifica soglie e invia warning al Capitano."""
    now = datetime.now()

    # Evita spam: massimo 1 warning ogni 5 minuti
    if state["last_warning"]:
        last_warn = datetime.fromisoformat(state["last_warning"])
        if now - last_warn < timedelta(minutes=5):
            return state

    if max_pct >= CRITICAL_PCT:
        msg = (f"[SENTINELLA] CRITICAL {max_pct:.0f}% — "
               f"Orario: {state['messages_hourly']}/{HOURLY_LIMIT} ({hourly_pct:.0f}%), "
               f"Giornaliero: {state['messages_daily']}/{DAILY_LIMIT} ({daily_pct:.0f}%). "
               f"RALLENTARE SUBITO. Rate: {rate_per_min:.1f} msg/min, "
               f"{len(sessions)} agenti attivi.")
        log(msg, "CRITICAL")
        send_to_captain(msg)
        state["last_warning"] = now.isoformat()
        state["warnings_sent"] += 1

    elif max_pct >= WARNING_PCT:
        eta_str = eta_limit.strftime("%H:%M") if eta_limit else "N/A"
        msg = (f"[SENTINELLA] WARNING {max_pct:.0f}% — "
               f"Rate: {rate_per_min:.1f} msg/min. "
               f"A questa velocita' si supera il limite tra {hours_to_limit:.1f}h "
               f"(ETA: {eta_str}). Consiglio ridurre agenti attivi.")
        log(msg, "WARNING")
        send_to_captain(msg)
        state["last_warning"] = now.isoformat()
        state["warnings_sent"] += 1

    return state


def format_status(state):
    """Formatta lo stato attuale in modo leggibile."""
    start_time = datetime.fromisoformat(state["start_time"])
    elapsed = datetime.now() - start_time
    elapsed_min = max(elapsed.total_seconds() / 60, 1)
    rate = state["messages_total"] / elapsed_min

    hourly_pct = (state["messages_hourly"] / HOURLY_LIMIT * 100) if HOURLY_LIMIT else 0
    daily_pct = (state["messages_daily"] / DAILY_LIMIT * 100) if DAILY_LIMIT else 0

    if rate > 0:
        remaining = DAILY_LIMIT - state["messages_daily"]
        mins_to_limit = remaining / rate
        eta = datetime.now() + timedelta(minutes=mins_to_limit)
        eta_str = eta.strftime("%H:%M")
        hours_str = f"{mins_to_limit / 60:.1f}h"
    else:
        eta_str = "N/A"
        hours_str = "inf"

    sessions = get_tmux_sessions()

    lines = [
        "=" * 55,
        "  SENTINELLA RATE LIMIT — Job Hunter Team",
        "=" * 55,
        f"  Agenti attivi:     {len(sessions)}",
        f"  Uptime:            {str(elapsed).split('.')[0]}",
        f"  Rate:              {rate:.2f} msg/min",
        "",
        f"  Orario:            {state['messages_hourly']}/{HOURLY_LIMIT} ({hourly_pct:.0f}%)",
        f"  Giornaliero:       {state['messages_daily']}/{DAILY_LIMIT} ({daily_pct:.0f}%)",
        f"  Totale sessione:   {state['messages_total']}",
        "",
        f"  Proiezione limite: {hours_str} (ETA: {eta_str})",
        f"  Warning inviati:   {state['warnings_sent']}",
        "",
        "  Per agente:",
    ]
    for agent, count in sorted(state.get("per_agent", {}).items(),
                                key=lambda x: -x[1]):
        lines.append(f"    {agent:20s} {count:5d} msg")

    if not state.get("per_agent"):
        lines.append("    (nessuna attivita' rilevata)")

    lines.append("=" * 55)
    return "\n".join(lines)


# ── Main ────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sentinella Rate Limit")
    parser.add_argument("--interval", type=int, default=CHECK_INTERVAL,
                        help=f"Secondi tra i check (default: {CHECK_INTERVAL})")
    parser.add_argument("--status", action="store_true",
                        help="Mostra stato attuale ed esci")
    parser.add_argument("--reset", action="store_true",
                        help="Reset contatori")
    args = parser.parse_args()

    if args.reset:
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        print("Contatori resettati.")
        return

    state = load_state()

    if args.status:
        print(format_status(state))
        return

    # Monitoraggio continuo
    log(f"Sentinella avviata — check ogni {args.interval}s, "
        f"limiti: {HOURLY_LIMIT}/h, {DAILY_LIMIT}/giorno")

    try:
        while True:
            state = check_and_reset_windows(state)
            state = monitor_cycle(state)
            save_state(state)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log("Sentinella fermata (Ctrl+C)")
        save_state(state)
        print("\n" + format_status(state))


if __name__ == "__main__":
    main()
