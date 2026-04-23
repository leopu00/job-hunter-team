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
import urllib.request
import urllib.error
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


def _claude_time_to_hhmm(match):
    """Dai group (hour, minute?, ampm) → 'HH:MM' 24h UTC."""
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    ampm = match.group(3).lower()
    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def parse_claude(text):
    """
    Claude Code /usage output:
      Resets 6:10pm (UTC)                                15% used  ← SESSIONE 5h
      Resets 7pm (UTC) (all models)                                ← weekly all
      Resets 6am (UTC) (Sonnet only)                               ← weekly sonnet

    Il primo Resets (quello SENZA suffisso "(all models)" o "(Sonnet
    only)") e' la sessione 5h — quello che monitoriamo come usage
    principale.

    Con tmux capture-pane la riga puo' essere wrappata: '% used'
    finisce sulla riga successiva rispetto a 'Resets'. Il vecchio
    regex richiedeva stessa riga e falliva ~50% dei tick; in piu'
    poteva agganciarsi al '% used' di una riga WEEKLY se la session
    non aveva '% used' catturato, causando salti 19→14 che l'utente
    ha osservato.

    Nuovo approccio:
      1. Trova TUTTE le righe 'Resets <time>' nell'output
      2. Il primo Resets senza 'all models' e 'only' e' la sessione
      3. Il primo '% used' dopo quel Resets (entro 200 char, cross-line)
         e' la percentuale di quella sessione
    Se la session non ha '% used' (es. modal appena aperto, valori non
    renderizzati), torna None: preferiamo saltare il tick piuttosto
    che scrivere un valore di un'altra finestra.
    """
    # Trova tutte le righe Resets con posizione
    resets = list(re.finditer(
        r"Resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)([^\n]*)",
        text, re.I,
    ))
    if not resets:
        return None

    # La sessione 5h: primo Resets la cui "coda di riga" NON contiene
    # ne' 'all models' ne' 'only' (case insensitive).
    session_match = None
    for m in resets:
        tail = (m.group(4) or "").lower()
        if "all models" not in tail and "only" not in tail:
            session_match = m
            break
    if session_match is None:
        # Tutte le righe sono weekly: output incompleto, salta questo tick
        return None

    # Cerca il primo '\d+% used' nella finestra di 200 char DOPO la
    # riga Resets (copre line wrap + eventuale spazio di layout).
    start = session_match.end()
    window = text[start:start + 200]
    m_used = re.search(r"(\d+)\s*%\s*used", window, re.I)
    if not m_used:
        return None

    return {
        "usage": int(m_used.group(1)),
        "reset_at": _claude_time_to_hhmm(session_match),
        "weekly_usage": None,
    }


def _duration_to_hhmm_future(match):
    """
    Converte 'Xd Yh Zm', 'Xh Ym', 'Ym' in HH:MM assoluto di quando scatta
    il reset (ora + delta), arrotondato al minuto.
    """
    days = int(match.group("d") or 0)
    hours = int(match.group("h") or 0)
    mins = int(match.group("m") or 0)
    delta = timedelta(days=days, hours=hours, minutes=mins)
    target = datetime.now() + delta
    return target.strftime("%H:%M")


def parse_kimi(text):
    """Fallback text parser (non piu' usato in produzione: vedi fetch_kimi_api).

    Il flusso primario per Kimi e' HTTP diretto via fetch_kimi_api. Mantenuto
    per debugging o se l'API cambia formato.
    """
    m5 = re.search(
        r"5h\s*limit[^\n]*?(\d+)\s*%\s*left[^\n]*?\(resets?\s*in\s*"
        r"(?:(?P<d>\d+)\s*d\s*)?(?:(?P<h>\d+)\s*h\s*)?(?:(?P<m>\d+)\s*m\s*)?",
        text, re.I,
    )
    if not m5:
        return None
    mw = re.search(r"Weekly\s*limit[^\n]*?(\d+)\s*%\s*left", text, re.I)
    return {
        "usage": 100 - int(m5.group(1)),
        "reset_at": _duration_to_hhmm_future(m5),
        "weekly_usage": (100 - int(mw.group(1))) if mw else None,
    }


# ── Kimi: chiamata HTTP diretta all'API (no tmux, no LLM) ──────────────

KIMI_CREDENTIALS = JHT_HOME / ".kimi" / "credentials" / "kimi-code.json"
KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages"


def _read_kimi_token():
    try:
        with KIMI_CREDENTIALS.open(encoding="utf-8") as f:
            creds = json.load(f)
        return creds.get("access_token")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _iso_to_hhmm(ts):
    """ISO 'YYYY-MM-DDTHH:MM:SSZ' → HH:MM locale o None."""
    if not ts:
        return None
    try:
        # Parse con timezone: 'Z' = UTC
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%H:%M")
    except (ValueError, TypeError):
        return None


def fetch_kimi_api():
    """
    Chiama direttamente https://api.kimi.com/coding/v1/usages con OAuth token
    dal file ~/.kimi/credentials/kimi-code.json.

    Evita completamente la TUI di Kimi: niente tmux send-keys, niente
    /usage che finisce nel prompt LLM, niente refusal che bruciano token.

    Risposta attesa:
      { "usage": {"used": "8", "remaining": "92", "resetTime": "..."},  # weekly
        "limits": [ {"detail": {"used": "38", "remaining": "62",
                                "resetTime": "..."}}, ... ] }  # 5h
    """
    token = _read_kimi_token()
    if not token:
        return None
    req = urllib.request.Request(KIMI_USAGES_URL, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
        data = json.loads(body)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, OSError):
        return None

    weekly = data.get("usage") or {}
    limits = data.get("limits") or []
    five_h = (limits[0] or {}).get("detail") if limits else None
    if not five_h:
        return None

    try:
        usage_5h = int(five_h.get("used", 0))
        weekly_used = int(weekly.get("used", 0)) if weekly.get("used") is not None else None
    except (TypeError, ValueError):
        return None

    return {
        "usage": usage_5h,
        "reset_at": _iso_to_hhmm(five_h.get("resetTime")),
        "weekly_usage": weekly_used,
    }


PARSERS = {
    "openai": parse_codex,
    "anthropic": parse_claude,
    "claude": parse_claude,
    "kimi": parse_kimi,
    "moonshot": parse_kimi,
}


# ─── Host resources (CPU / RAM) ──────────────────────────────────────

def read_cpu_count():
    """Numero di core visibili al container (rispetta cgroup cpuset)."""
    try:
        return os.cpu_count() or 1
    except Exception:
        return 1


def read_host_resources():
    """
    Ritorna dict con le metriche di pressione del container:
      cpu_pct      — load avg 1m normalizzato su numero core (0..100+)
      ram_pct      — (MemTotal - MemAvailable) / MemTotal * 100
      ram_used_mb  — memoria in uso in MB
      ram_total_mb — memoria totale visibile al container
      load_1m      — valore raw di /proc/loadavg 1 min
    Su Linux VM di Docker Desktop riflette la fetta di risorse del VM —
    se satura, il Capitano deve rallentare lo spawn o killare istanze.
    """
    try:
        with open("/proc/loadavg") as f:
            load_1m = float(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        load_1m = 0.0

    ram_total_kb = 0
    ram_avail_kb = 0
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    ram_total_kb = int(line.split()[1])
                elif line.startswith("MemAvailable:"):
                    ram_avail_kb = int(line.split()[1])
                if ram_total_kb and ram_avail_kb:
                    break
    except (OSError, ValueError, IndexError):
        pass

    cores = read_cpu_count()
    cpu_pct = round((load_1m / cores) * 100, 1) if cores else 0.0
    ram_used_kb = max(0, ram_total_kb - ram_avail_kb)
    ram_pct = round(ram_used_kb / ram_total_kb * 100, 1) if ram_total_kb else 0.0

    return {
        "cpu_pct": cpu_pct,
        "ram_pct": ram_pct,
        "ram_used_mb": ram_used_kb // 1024,
        "ram_total_mb": ram_total_kb // 1024,
        "load_1m": round(load_1m, 2),
        "cores": cores,
    }


def host_pressure_level(host):
    """
    Combina CPU% e RAM% in un livello 'pressure' usato dalla Sentinella
    per decidere se forzare un throttle piu' alto anche se il rate-limit
    e' basso. Soglie calibrate per un VM 12 core / 15 GB (tipico Docker
    Desktop su Windows):
      cpu_pct > 95 o ram_pct > 92  → CRITICAL (suggerisci T4)
      cpu_pct > 80 o ram_pct > 85  → HIGH     (T3)
      cpu_pct > 60 o ram_pct > 75  → MEDIUM   (T1-T2)
      altrimenti                   → OK
    """
    cpu = host.get("cpu_pct", 0)
    ram = host.get("ram_pct", 0)
    if cpu > 95 or ram > 92:
        return "CRITICAL"
    if cpu > 80 or ram > 85:
        return "HIGH"
    if cpu > 60 or ram > 75:
        return "MEDIUM"
    return "OK"


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

    # Host resources: se la pressione e' alta, forziamo un throttle
    # minimo anche se l'usage LLM e' basso. Il PC sovraccarico fa
    # crashare i CLI o il container comunque; meglio fermarsi prima.
    host = read_host_resources()
    host_level = host_pressure_level(host)
    forced_throttle = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "OK": 0}[host_level]
    if forced_throttle > throttle:
        throttle = forced_throttle
        if status not in ("CRITICO", "RESET"):
            status = "ATTENZIONE" if host_level == "MEDIUM" else "CRITICO"

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
        "host": host,
        "host_level": host_level,
        "source": "bridge",
    }


# ─── Output ──────────────────────────────────────────────────────────

def write_jsonl(entry):
    with DATA_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def write_log(entry):
    host = entry.get("host") or {}
    host_str = (
        f"cpu={host.get('cpu_pct', '-')}% ram={host.get('ram_pct', '-')}% "
        f"({entry.get('host_level', '-')})"
    ) if host else "host=-"
    line = (
        f"[{entry['ts']}] provider={entry['provider']} "
        f"usage={entry['usage']}% delta={entry['delta']:+g}% "
        f"vel_smooth={entry['velocity_smooth']:g}%/h "
        f"vel_ideale={entry.get('velocity_ideal') if entry.get('velocity_ideal') is not None else '-'}%/h "
        f"projection={entry.get('projection') if entry.get('projection') is not None else '-'}% "
        f"STATO={entry['status']} throttle={entry['throttle']} "
        f"{host_str} (bridge)"
    )
    with LOG_TXT.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def notify_sentinella(entry):
    """Manda i dati gia' parsati alla Sentinella LLM."""
    host = entry.get("host") or {}
    host_str = (
        f" host_cpu={host.get('cpu_pct', '-')}% host_ram={host.get('ram_pct', '-')}%"
        f" ({entry.get('host_level', '-')})"
    )
    msg = (
        f"[BRIDGE TICK] provider={entry['provider']} "
        f"usage={entry['usage']}% delta={entry['delta']:+g}% "
        f"status={entry['status']} throttle={entry['throttle']} "
        f"projection={entry.get('projection') if entry.get('projection') is not None else '-'}% "
        f"reset_at={entry.get('reset_at') or '-'}"
        f"{host_str}. "
        f"I dati sono gia' parsati e loggati dal bridge. NON eseguire /status. "
        f"Decidi SOLO se e come avvisare il Capitano in base a status/throttle/host_level e al cooldown. "
        f"NB: host_level CRITICAL/HIGH = PC saturo, ordina al Capitano T3/T4 anche se usage LLM e' basso."
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

        # Kimi: HTTP diretto all'API (niente TUI, niente token bruciati su
        # refusal LLM perche' la TUI non riconosce /usage come slash-command).
        if provider in ("kimi", "moonshot"):
            parsed = fetch_kimi_api()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_kimi_api fallito (token scaduto? no rete?)")
                time.sleep(min(POLL_SECONDS, tick_min * 60))
                continue
        else:
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
