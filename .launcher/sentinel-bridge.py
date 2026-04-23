#!/usr/bin/env python3
"""
Sentinel Bridge — polling deterministico + trigger alla Sentinella LLM.

Sostituisce il vecchio sentinel-ticker.py: invece di svegliare la
Sentinella perche' faccia tutto (polling + parsing + matematica + log
+ alert), il bridge esegue /status (codex) o /usage (claude/kimi) sul
SENTINELLA-WORKER, parsa l'output con regex, calcola le metriche
derivate, scrive i file di log, e notifica la Sentinella LLM con i dati
gia' pronti perche' decida solo se e come avvisare il Capitano.

Vantaggio: parsing e matematica sono deterministici (no allucinazioni
dell'LLM); l'agente Codex/Kimi/Claude della Sentinella resta in loop
solo per il decision making (alert, urgenza, cooldown), non per leggere
e calcolare.

Config dinamica:
  sentinella_tick_minutes in $JHT_HOME/jht.config.json (range 1-60)
  JHT_SENTINEL_SESSION     sessione LLM (default SENTINELLA)
  JHT_SENTINEL_WORKER      sessione worker (default SENTINELLA-WORKER)
  JHT_HOME                 dir config (default ~/.jht)
  JHT_TICK_INTERVAL        bootstrap se il config non ha il campo
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path


SESSION = os.environ.get("JHT_SENTINEL_SESSION", "SENTINELLA")
WORKER = os.environ.get("JHT_SENTINEL_WORKER", "SENTINELLA-WORKER")
JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
CONFIG_PATH = JHT_HOME / "jht.config.json"
LOGS_DIR = JHT_HOME / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
DATA_JSONL = LOGS_DIR / "sentinel-data.jsonl"
LOG_TXT = LOGS_DIR / "sentinel-log.txt"

POLL_SECONDS = 15
MIN_INTERVAL = 1
MAX_INTERVAL = 60
BOOTSTRAP = int(os.environ.get("JHT_TICK_INTERVAL", "10"))


def read_config():
    """Ritorna (tick_minutes, provider). Fallback ai default se file manca."""
    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            cfg = json.load(f)
        n = cfg.get("sentinella_tick_minutes")
        tick = int(round(n)) if isinstance(n, (int, float)) and MIN_INTERVAL <= n <= MAX_INTERVAL else BOOTSTRAP
        provider = cfg.get("active_provider") or "openai"
        return tick, provider
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return BOOTSTRAP, "openai"


def session_exists(s):
    r = subprocess.run(["tmux", "has-session", "-t", s], capture_output=True)
    return r.returncode == 0


def tmux_send_keys(session, *keys):
    return subprocess.run(["tmux", "send-keys", "-t", session, *keys], capture_output=True).returncode == 0


def tmux_capture(session, lines=200):
    r = subprocess.run(["tmux", "capture-pane", "-t", session, "-p", "-S", f"-{lines}"], capture_output=True)
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else ""


def jht_tmux_send(session, text):
    return subprocess.run(["jht-tmux-send", session, text], capture_output=True, timeout=15).returncode == 0


def query_status(provider):
    """
    Chiude eventuali modal aperti sul worker, invia /status (codex) o
    /usage (claude/kimi), attende il render, ritorna il pane catturato.
    """
    # Escape × 2 per chiudere modal pendenti (input box, dialog /status, ecc.)
    for _ in range(2):
        tmux_send_keys(WORKER, "Escape")
        time.sleep(0.3)

    cmd = "/status" if provider == "openai" else "/usage"
    # Testo + Enter separati: alcuni CLI (codex) non accettano slash-command
    # se il send-keys include gia' C-m.
    tmux_send_keys(WORKER, cmd)
    time.sleep(0.4)
    tmux_send_keys(WORKER, "Enter")
    time.sleep(4.0)
    return tmux_capture(WORKER)


# ─── Parser per ciascun provider ─────────────────────────────────────

def parse_codex(text):
    """
    Codex /status:
      5h limit:      [bars] XX% left (resets HH:MM)
      Weekly limit:  [bars] YY% left (resets HH:MM on DD Mon)
    'XX% left' → usage = 100 - XX.
    """
    m5 = re.search(r"5h\s*limit:[^\n]*?(\d+)\s*%\s*left[^\n]*?\(resets?\s*(\d{1,2}:\d{2})", text, re.I)
    mw = re.search(r"Weekly\s*limit:[^\n]*?(\d+)\s*%\s*left", text, re.I)
    if not m5:
        return None
    return {
        "usage": 100 - int(m5.group(1)),
        "reset_at": m5.group(2),
        "weekly_usage": (100 - int(mw.group(1))) if mw else None,
    }


def parse_claude(text):
    """
    Claude /usage (pattern approssimativo, formato variabile):
      'XX% used' + eventuale finestra (settimana/sessione).
    """
    m = re.search(r"(\d+)\s*%\s*used", text, re.I)
    if not m:
        return None
    return {"usage": int(m.group(1)), "reset_at": None, "weekly_usage": None}


def parse_kimi(text):
    """
    Kimi /usage: progress bar + 'XX% remaining' o simile.
    Fallback conservativo: cerca 'remaining' o 'used'.
    """
    m_rem = re.search(r"(\d+)\s*%\s*remaining", text, re.I)
    if m_rem:
        return {"usage": 100 - int(m_rem.group(1)), "reset_at": None, "weekly_usage": None}
    m_used = re.search(r"(\d+)\s*%\s*used", text, re.I)
    if m_used:
        return {"usage": int(m_used.group(1)), "reset_at": None, "weekly_usage": None}
    return None


PARSERS = {
    "openai": parse_codex,
    "anthropic": parse_claude,
    "claude": parse_claude,
    "kimi": parse_kimi,
    "moonshot": parse_kimi,
}


# ─── State & metrics ─────────────────────────────────────────────────

def load_last_sample():
    if not DATA_JSONL.exists():
        return None
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        return json.loads(raw[-1]) if raw else None
    except (OSError, json.JSONDecodeError, IndexError):
        return None


def hours_until(reset_hhmm):
    """HH:MM → ore float mancanti; se gia' passata, assume domani."""
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds() / 3600


def compute_metrics(parsed, last):
    """Deriva delta, velocity, projection, status, throttle partendo dal campione parsato."""
    usage = parsed["usage"]
    now = datetime.now(timezone.utc)
    ts = now.isoformat()

    delta = 0.0
    velocity = 0.0
    if last and isinstance(last.get("usage"), (int, float)):
        try:
            last_ts = datetime.fromisoformat(last["ts"])
            dt_h = max(0.01, (now - last_ts).total_seconds() / 3600)
            delta = usage - last["usage"]
            velocity = delta / dt_h
        except (TypeError, ValueError):
            pass

    # EMA alpha=0.5 con velocity_smooth precedente (0 se manca)
    vs_prev = (last or {}).get("velocity_smooth") or 0.0
    velocity_smooth = 0.5 * velocity + 0.5 * vs_prev

    hours_to_reset = hours_until(parsed.get("reset_at"))
    velocity_ideal = None
    projection = None
    if hours_to_reset and hours_to_reset > 0:
        # Target 92% alla finestra piena (sotto il 100% per margine)
        velocity_ideal = max(0.0, (92 - usage) / hours_to_reset)
        projection = usage + velocity_smooth * hours_to_reset

    reset_event = bool(last and usage < (last.get("usage") or 0) - 30)

    if reset_event:
        status, throttle = "RESET", 0
    elif projection is None:
        status, throttle = ("SOTTOUTILIZZO" if usage < 30 else "OK"), 0
    elif projection <= 90:
        status, throttle = ("SOTTOUTILIZZO" if usage < 30 else "OK"), 0
    elif projection <= 110:
        status, throttle = "ATTENZIONE", 1
    elif projection <= 130:
        status, throttle = "ATTENZIONE", 2
    elif projection <= 160:
        status, throttle = "CRITICO", 3
    else:
        status, throttle = "CRITICO", 4

    return {
        "ts": ts,
        "provider": parsed.get("provider", "openai"),
        "usage": usage,
        "delta": round(delta, 2),
        "velocity": round(velocity, 2),
        "velocity_smooth": round(velocity_smooth, 2),
        "velocity_ideal": round(velocity_ideal, 2) if velocity_ideal is not None else None,
        "projection": round(projection, 2) if projection is not None else None,
        "status": status,
        "throttle": throttle,
        "reset_at": parsed.get("reset_at"),
        "weekly_usage": parsed.get("weekly_usage"),
        "source": "bridge",
    }


# ─── Output ──────────────────────────────────────────────────────────

def write_jsonl(entry):
    with DATA_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def write_log(entry):
    line = (
        f"[{entry['ts']}] provider={entry['provider']} "
        f"usage={entry['usage']}% delta={entry['delta']:+g}% "
        f"vel_smooth={entry['velocity_smooth']:g}%/h "
        f"vel_ideale={entry.get('velocity_ideal') if entry.get('velocity_ideal') is not None else '-'}%/h "
        f"projection={entry.get('projection') if entry.get('projection') is not None else '-'}% "
        f"STATO={entry['status']} throttle={entry['throttle']} (bridge)"
    )
    with LOG_TXT.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def notify_sentinella(entry):
    """Manda i dati gia' parsati alla Sentinella LLM."""
    msg = (
        f"[BRIDGE TICK] provider={entry['provider']} "
        f"usage={entry['usage']}% delta={entry['delta']:+g}% "
        f"status={entry['status']} throttle={entry['throttle']} "
        f"projection={entry.get('projection') if entry.get('projection') is not None else '-'}% "
        f"reset_at={entry.get('reset_at') or '-'}. "
        f"I dati sono gia' parsati e loggati dal bridge. NON eseguire /status. "
        f"Decidi SOLO se e come avvisare il Capitano in base a status/throttle e al cooldown."
    )
    jht_tmux_send(SESSION, msg)


# ─── Loop & sleep dinamico ───────────────────────────────────────────

def sleep_with_poll(target_min):
    total_sec = target_min * 60
    elapsed = 0
    current = target_min
    while elapsed < total_sec:
        time.sleep(min(POLL_SECONDS, total_sec - elapsed))
        elapsed += POLL_SECONDS
        fresh, _ = read_config()
        if fresh != current:
            new_total = fresh * 60
            if elapsed >= new_total:
                return
            total_sec = new_total
            current = fresh


def main():
    print(f"[sentinel-bridge] LLM session: {SESSION}, worker: {WORKER}")
    print(f"[sentinel-bridge] config: {CONFIG_PATH} (bootstrap: {BOOTSTRAP}m)")
    while True:
        if not session_exists(WORKER):
            print(f"[sentinel-bridge] {WORKER} non attivo, attendo 30s...")
            time.sleep(30)
            continue

        tick_min, provider = read_config()
        now_h = datetime.now().strftime("%H:%M:%S")

        raw = query_status(provider)
        parser = PARSERS.get(provider, parse_codex)
        parsed = parser(raw)
        if parsed is None:
            print(f"[sentinel-bridge] {now_h} — parser fallito (provider={provider})")
            time.sleep(min(POLL_SECONDS, tick_min * 60))
            continue
        parsed["provider"] = provider

        last = load_last_sample()
        entry = compute_metrics(parsed, last)
        write_jsonl(entry)
        write_log(entry)
        if session_exists(SESSION):
            notify_sentinella(entry)

        print(
            f"[sentinel-bridge] {now_h} — usage={entry['usage']}% "
            f"status={entry['status']} t={entry['throttle']} "
            f"projection={entry.get('projection') or '-'} (next in {tick_min}m)"
        )
        sleep_with_poll(tick_min)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[sentinel-bridge] interrotto.")
        sys.exit(0)
