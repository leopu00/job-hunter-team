#!/usr/bin/env python3
"""
Sentinel Bridge — polling deterministico + trigger alla Sentinella LLM.

Il bridge polla il rate limit del provider attivo via:
  - HTTP API per kimi (/coding/v1/usages) e claude (/api/oauth/usage)
  - Lettura dei rollout JSONL in ~/.codex/sessions/ per openai/codex

Parsa i dati, calcola metriche derivate (delta, velocity, projection,
status, throttle, host CPU/RAM), scrive sentinel-data.jsonl +
sentinel-log.txt, e notifica la Sentinella LLM con [BRIDGE TICK]: l'LLM
decide solo se e come avvisare il Capitano, non legge/calcola.

Vantaggi del pattern: matematica deterministica (no allucinazioni LLM),
token risparmiati (la Sentinella non polla piu' /status direttamente),
cross-provider (HTTP + file = zero dipendenza da TUI).

Policy edge-triggered: il bridge calcola deterministicamente il livello
throttle (T0..T4) ad ogni tick e manda un [BRIDGE ORDER] alla sessione
CAPITANO SOLO quando la policy cambia (throttle / host_level / status).
Niente turn LLM sprecati su fotocopie di stato stabile — il Capitano
riceve ordini chiari e non duplicati.

Config dinamica:
  sentinella_tick_minutes in $JHT_HOME/jht.config.json (range 1-60)
  JHT_TARGET_SESSION       sessione destinataria ordini (default CAPITANO)
  JHT_HOME                 dir config (default ~/.jht)
  JHT_TICK_INTERVAL        bootstrap se il config non ha il campo
"""

import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path


TARGET_SESSION = os.environ.get("JHT_TARGET_SESSION", "CAPITANO")
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

# Finestra ottimale di consumo: 2 soli numeri, 85 e 95.
#   projection > 95 → stiamo bruciando troppo (alert RALLENTA)
#   projection < 85 → stiamo sottoutilizzando (alert SPINGI)
#   85 ≤ projection ≤ 95 → zona target, silenzio
# Nessuna isteresi: se proj balla sui boundary, il notify on-change
# ed escalation a dwell (level_entered_at) filtrano comunque lo spam.
PROJ_HIGH = 95
PROJ_LOW = 85

# Costante di tempo del rientro: dopo un ordine di throttle, gli agenti
# impiegano ~5 min a rallentare davvero (sleep allungati, completamento
# turni in corso). Modellare τ permette alla projection di prevedere il
# rientro invece di estrapolare linearmente la velocity istantanea —
# senza questa correzione il bridge oscilla (RALLENTA → SOTTO →
# RALLENTA …) come una doccia con miscelatore in ritardo.
TAU_HOURS = 5.0 / 60.0


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


def jht_tmux_send(session, text):
    return subprocess.run(["jht-tmux-send", session, text], capture_output=True, timeout=15).returncode == 0


def tmux_capture(session, lines=200):
    """Leggi le ultime N righe del pane tmux di `session` (stdout del CLI).
    Usato dai parser TUI di fallback quando l'HTTP API del provider fallisce
    (es. rate-limit Anthropic sul /usage endpoint)."""
    r = subprocess.run(
        ["tmux", "capture-pane", "-t", session, "-p", "-S", f"-{lines}"],
        capture_output=True,
    )
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else ""


def tmux_send_keys(session, *keys):
    """Invia keypress alla sessione tmux. Non-invasivo: serve solo per
    pilotare il SENTINELLA-WORKER (CLI idle) dentro i fallback TUI."""
    return subprocess.run(
        ["tmux", "send-keys", "-t", session, *keys],
        capture_output=True,
    ).returncode == 0


# ── Codex: lettura rollout JSONL (no HTTP CF-blocked, no tmux) ──────

CODEX_SESSIONS_DIR = JHT_HOME / ".codex" / "sessions"


def fetch_codex_rollout():
    """
    Ogni sessione codex scrive eventi in
    ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessid>.jsonl.
    Gli eventi type='event_msg' payload='token_count' includono:
      rate_limits: {
        primary:  { used_percent, window_minutes: 300,  resets_at: <unix> }
        secondary:{ used_percent, window_minutes: 10080, resets_at: <unix> }
        plan_type, rate_limit_reached_type, ...
      }
    Evita: HTTP (chatgpt.com/backend-api blocca con 403 senza cf_clearance),
    TUI (/status su worker spesso non parseable), telemetria (solo CLI).

    Strategia:
      1. Trova il rollout JSONL piu' recente (mtime) sotto sessions/
      2. Leggi ultime ~200 righe, trova l'ultima con 'rate_limits'
      3. Estrai primary.used_percent + resets_at
    Un rate_limits fresh e' prodotto ad ogni turno di qualunque agente
    codex: se ne gira almeno uno nell'ultima ora, il dato e' fresco.
    """
    try:
        if not CODEX_SESSIONS_DIR.exists():
            return None

        # Raccogli i 10 rollout piu' recenti (walk ricorsivo, skip < 512B)
        candidates = []
        for p in CODEX_SESSIONS_DIR.rglob("rollout-*.jsonl"):
            try:
                st = p.stat()
                if st.st_size >= 512:
                    candidates.append((st.st_mtime, p))
            except OSError:
                continue
        if not candidates:
            return None
        candidates.sort(reverse=True)
        candidates = candidates[:10]

        # Sessioni che hanno HIT il limite scrivono rate_limits con
        # primary=null + payload.type=error usage_limit_exceeded. In
        # quel caso ripieghiamo sui rollout precedenti che hanno i
        # valori ancora validi.
        best_rl = None
        best_ts = None
        for _, p in candidates:
            try:
                with p.open("rb") as f:
                    f.seek(0, os.SEEK_END)
                    size = f.tell()
                    f.seek(max(0, size - 200_000))
                    tail = f.read().decode("utf-8", errors="replace")
            except OSError:
                continue
            lines = tail.splitlines()[-300:]
            for line in reversed(lines):
                if '"rate_limits"' not in line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue
                pl = evt.get("payload") or {}
                rl = pl.get("rate_limits") or ((pl.get("info") or {}).get("rate_limits"))
                if not rl:
                    continue
                primary = rl.get("primary")
                if not (primary and primary.get("used_percent") is not None):
                    continue
                ts_str = evt.get("timestamp")
                if best_ts is None or (ts_str and ts_str > best_ts):
                    best_ts = ts_str
                    best_rl = rl
                break  # primo rate_limits valido in questo file = piu' recente
            if best_rl:
                break  # gia' preso dal file piu' recente disponibile

        if not best_rl:
            return None

        primary = best_rl.get("primary") or {}
        secondary = best_rl.get("secondary") or {}
        try:
            usage = int(round(float(primary.get("used_percent", 0))))
            weekly = (
                int(round(float(secondary.get("used_percent", 0))))
                if secondary.get("used_percent") is not None else None
            )
        except (TypeError, ValueError):
            return None

        reset_at = None
        resets_unix = primary.get("resets_at")
        if isinstance(resets_unix, (int, float)):
            reset_at = datetime.fromtimestamp(resets_unix, timezone.utc).astimezone().strftime("%H:%M")

        return {
            "usage": usage,
            "reset_at": reset_at,
            "weekly_usage": weekly,
        }
    except (OSError, json.JSONDecodeError):
        return None


# ── Claude: chiamata HTTP diretta all'API (no tmux, no LLM) ────────────

CLAUDE_CREDENTIALS = JHT_HOME / ".claude" / ".credentials.json"
CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"


def _read_claude_token():
    try:
        with CLAUDE_CREDENTIALS.open(encoding="utf-8") as f:
            creds = json.load(f)
        return (creds.get("claudeAiOauth") or {}).get("accessToken")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


CLAUDE_USAGE_CACHE = LOGS_DIR / "claude-usage-cache.json"
CLAUDE_429_COOLDOWN_FILE = LOGS_DIR / "claude-429-cooldown"
CLAUDE_429_COOLDOWN_S = 300   # 5 min — bug noto Anthropic: l'endpoint
                              # /api/oauth/usage resta 429 per ore se pressato.
                              # 5 min dà tempo alla rate-limit window di Anthropic
                              # di rilassarsi senza tenerci troppo al buio.
                              # Vedi github.com/anthropics/claude-code/issues/30930


def _load_claude_429_cooldown():
    """Leggi l'epoch di fine cooldown dal file. Persistente tra restart del
    bridge: un kill&respawn non azzera piu' la protezione e non prende altri
    429 ritestando l'endpoint inutilmente."""
    try:
        return float(CLAUDE_429_COOLDOWN_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0.0


def _save_claude_429_cooldown(until_epoch):
    try:
        CLAUDE_429_COOLDOWN_FILE.write_text(f"{until_epoch:.0f}", encoding="utf-8")
    except OSError:
        pass


_claude_429_until = _load_claude_429_cooldown()


def _cache_load_claude():
    try:
        with CLAUDE_USAGE_CACHE.open(encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _cache_save_claude(parsed):
    try:
        CLAUDE_USAGE_CACHE.write_text(
            json.dumps({"saved_at": time.time(), **parsed}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def fetch_claude_api():
    """
    Chiama https://api.anthropic.com/api/oauth/usage con OAuth token da
    ~/.claude/.credentials.json. Endpoint interno usato dal CLI claude
    per /usage; stabile, strutturato, zero TUI.

    Ritorna uno di:
      dict {usage, reset_at, weekly_usage}  — fetch OK
      None                                  — fetch KO (token/rete/parse)
      "RATE_LIMIT"                          — HTTP 429, entra in cooldown

    Bug noto Anthropic: /api/oauth/usage rate-limita aggressivamente
    (retry-after:0 fuorviante) e resta 429 per ore anche con backoff.
    Usiamo un cooldown locale (_claude_429_until) per non accanirci,
    piu' una cache dell'ultimo sample valido per riusarlo stale.
    """
    global _claude_429_until
    if time.time() < _claude_429_until:
        return "RATE_LIMIT"

    token = _read_claude_token()
    if not token:
        return None
    req = urllib.request.Request(
        CLAUDE_USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
        data = json.loads(body)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _claude_429_until = time.time() + CLAUDE_429_COOLDOWN_S
            _save_claude_429_cooldown(_claude_429_until)
            return "RATE_LIMIT"
        return None
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
        return None

    five_h = data.get("five_hour") or {}
    seven_d = data.get("seven_day") or {}
    try:
        usage_5h = int(round(float(five_h.get("utilization", 0))))
        weekly = int(round(float(seven_d.get("utilization", 0)))) if seven_d.get("utilization") is not None else None
    except (TypeError, ValueError):
        return None

    parsed = {
        "usage": usage_5h,
        "reset_at": _iso_to_hhmm(five_h.get("resets_at")),
        "weekly_usage": weekly,
    }
    _cache_save_claude(parsed)
    return parsed


def fetch_claude_cached(max_age_s=900):
    """Riusa l'ultimo sample scritto su disco se non troppo vecchio.
    Per coprire le finestre di 429 senza mentire col valore stale per ore."""
    cached = _cache_load_claude()
    if not cached:
        return None
    saved_at = cached.get("saved_at", 0)
    if time.time() - saved_at > max_age_s:
        return None
    return {
        "usage": cached.get("usage"),
        "reset_at": cached.get("reset_at"),
        "weekly_usage": cached.get("weekly_usage"),
    }


# ── Claude TUI: fallback parser via tmux capture ─────────────────────────
# Usato quando /api/oauth/usage fallisce (rate-limit 429, rete, token scaduto).
# Il parser legge direttamente il pane della sessione CAPITANO: se in buffer
# c'e' del testo da `/usage` recente (modal o scroll), estrae l'usage della
# sessione 5h. Se non c'e', ritorna None — a quel punto il bridge logga
# "nessun dato" ma il loop continua (no crash, no stato stantio).

def _claude_time_to_hhmm(match):
    """Dai gruppi (hour, minute?, ampm) → 'HH:MM' 24h UTC."""
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    ampm = match.group(3).lower()
    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def parse_claude_tui(text):
    """Parsa output della CLI claude per estrarre usage della sessione 5h.

    Formato atteso (output di `/usage`, wrappabile cross-line):
        Resets 6:10pm (UTC)                                15% used
        Resets 7pm (UTC) (all models)
        Resets 6am (UTC) (Sonnet only)

    Il primo Resets SENZA tag "(all models)" / "(Sonnet only)" e' la
    sessione 5h. Cerchiamo il primo "% used" nei 400 char successivi a
    quel Resets, fermandoci al prossimo Resets per non 'rubare' valori
    dalle sezioni weekly.
    """
    if not text:
        return None
    resets = list(re.finditer(
        r"Resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)([^\n]*)",
        text, re.I,
    ))
    if not resets:
        return None
    session_match = None
    for m in resets:
        tail = (m.group(4) or "").lower()
        if "all models" not in tail and "only" not in tail:
            session_match = m
            break
    if session_match is None:
        return None
    start = session_match.start()
    next_reset_pos = len(text)
    for m in resets:
        if m.start() > session_match.start():
            next_reset_pos = m.start()
            break
    window = text[start:min(next_reset_pos, start + 400)]
    m_used = re.search(r"(\d+)\s*%\s*used", window, re.I)
    if not m_used:
        return None
    return {
        "usage": int(m_used.group(1)),
        "reset_at": _claude_time_to_hhmm(session_match),
        "weekly_usage": None,
    }


def fetch_claude_tui(session):
    """Cattura il pane della sessione claude e prova a estrarre l'usage.
    Wrapper thin: serve come 2° canale per il main loop."""
    buf = tmux_capture(session)
    return parse_claude_tui(buf)


WORKER_SESSION = os.environ.get("JHT_SENTINEL_WORKER", "SENTINELLA-WORKER")
JHT_HOME_PATH = os.environ.get("JHT_HOME", str(Path.home() / ".jht"))


def worker_alive():
    return subprocess.run(
        ["tmux", "has-session", "-t", WORKER_SESSION],
        capture_output=True,
    ).returncode == 0


START_AGENT_SH = os.environ.get("JHT_START_AGENT_SH", "/app/.launcher/start-agent.sh")


def spawn_claude_worker():
    """Crea la sessione SENTINELLA-WORKER delegando a start-agent.sh worker.
    Riusa il path robusto del launcher (dimensioni tmux, env setup, auto-accept
    trust dialog) invece di duplicare la logica qui. Idempotente: se il worker
    è gia' vivo lo script esce senza fare nulla."""
    if worker_alive():
        return True
    try:
        r = subprocess.run(
            ["bash", START_AGENT_SH, "worker"],
            capture_output=True, timeout=10,
        )
        if r.returncode != 0:
            # Log dell'errore per debugging (non fatale: il tick successivo
            # ritenta lo spawn).
            err = (r.stderr or b"").decode("utf-8", errors="replace").strip()[:200]
            if err:
                print(f"[sentinel-bridge] spawn worker fallito: {err}")
            return False
        return True
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"[sentinel-bridge] spawn worker exception: {e}")
        return False


def kill_worker():
    """Termina la sessione SENTINELLA-WORKER. Idempotente."""
    subprocess.run(
        ["tmux", "kill-session", "-t", WORKER_SESSION],
        capture_output=True,
    )


def query_claude_worker():
    """Fallback pro-attivo: interroga SENTINELLA-WORKER col comando `/usage`,
    aspetta il render, cattura il pane e parsa. A differenza di fetch_claude_tui
    (che legge la sessione del Capitano passivamente), qui DIGITIAMO `/usage`
    nella worker session apposita → il dato c'è sempre, non dipende dall'umore
    del Capitano. Usato quando l'HTTP API è 429 o irraggiungibile.

    Flusso:
      /usage → Enter → 4s render → capture → parse.

    NON mandiamo Esc prima: se il CLI claude è ancora nel dialog "trust
    directory" (boot iniziale), Esc = cancel → CLI esce → i comandi
    successivi vanno in bash e /usage diventa 'command not found'. Enter
    da solo è safe: in idle inserisce empty input (harmless), in dialog
    accetta (default button). Se il CLI è in mezzo ad altro input, peggio
    che possa succedere è che il prossimo tick riprova.
    """
    r = subprocess.run(
        ["tmux", "has-session", "-t", WORKER_SESSION],
        capture_output=True,
    )
    if r.returncode != 0:
        return None
    # Testo + Enter separati: alcune CLI non interpretano la slash se il
    # send-keys include gia' C-m nel testo.
    tmux_send_keys(WORKER_SESSION, "/usage")
    time.sleep(0.4)
    tmux_send_keys(WORKER_SESSION, "Enter")
    time.sleep(4.0)
    buf = tmux_capture(WORKER_SESSION)
    return parse_claude_tui(buf)


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


def load_recent_samples(n=30):
    """Ultimi n sample (o meno) dal JSONL, in ordine cronologico."""
    if not DATA_JSONL.exists():
        return []
    try:
        lines = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()[-n:]
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        return out
    except OSError:
        return []


def cumulative_delta_last_hour(history, now_ts):
    """Somma delta POSITIVI negli ultimi 60 minuti (indicatore di carico reale)."""
    cutoff = now_ts - timedelta(minutes=60)
    total = 0.0
    for e in history:
        try:
            ts = datetime.fromisoformat(e["ts"])
        except (KeyError, TypeError, ValueError):
            continue
        if ts < cutoff:
            continue
        d = e.get("delta")
        if isinstance(d, (int, float)) and d > 0:
            total += float(d)
    return total


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


def compute_metrics(parsed, last, history=None):
    """Deriva delta, velocity, projection, status, throttle partendo dal campione parsato.

    history: lista opzionale degli ultimi N entry del JSONL, usata per:
      - filtro burst: se il delta cumulativo dell'ultima ora e' basso, NON
        permettiamo alla proiezione di spingere su CRITICO sulla base di un
        singolo spike di velocity
    """
    # Target a finestra piena. L'utilizzatore paga per il 100% della
    # quota, ha senso puntare al 95% (margine piccolo per imprevisti).
    # Prima era 92%, troppo conservativo.
    SAFE_TARGET = 95

    # Finestra ottimale di consumo (applicata più sotto via PROJ_HIGH/LOW).
    # Vedi i constants a livello modulo.

    usage = parsed["usage"]
    now = datetime.now(timezone.utc)
    ts = now.isoformat()
    history = history or []

    delta = 0.0
    velocity = 0.0
    session_gap_min = 0.0
    if last and isinstance(last.get("usage"), (int, float)):
        try:
            last_ts = datetime.fromisoformat(last["ts"])
            session_gap_min = (now - last_ts).total_seconds() / 60.0
            dt_h = max(0.01, (now - last_ts).total_seconds() / 3600)
            delta = usage - last["usage"]
            velocity = delta / dt_h
        except (TypeError, ValueError):
            pass

    # Session discontinuity: se il bridge e' stato fermo per piu' di 20
    # minuti (crash, restart, team stoppato e riavviato), l'EMA ereditata
    # dall'ultimo sample non e' piu' rappresentativa del ritmo attuale —
    # spesso drogava il throttle a CRITICO nei primi tick della nuova
    # sessione per via di una velocity intensiva misurata ORE fa, anche
    # se la sessione attuale sta consumando tranquillamente.
    # Reset cold-start: azzera EMA e delta, riparti da zero.
    session_discontinuity = session_gap_min > 20
    if session_discontinuity:
        velocity = 0.0
        velocity_smooth = 0.0
    else:
        # EMA con alpha=0.2 (finestra effettiva ~10 sample): un burst di
        # 30s pesa ~20% e decade in pochi tick, quindi evita proiezioni
        # drogate da spike momentanei.
        vs_prev = (last or {}).get("velocity_smooth") or 0.0
        velocity_smooth = 0.2 * velocity + 0.8 * vs_prev

    hours_to_reset = hours_until(parsed.get("reset_at"))
    velocity_ideal = None
    projection = None
    projection_naive = None  # solo per logging / debug
    if hours_to_reset and hours_to_reset > 0:
        velocity_ideal = max(0.0, (SAFE_TARGET - usage) / hours_to_reset)
        projection_naive = usage + velocity_smooth * hours_to_reset
        # Modello first-order del rientro (vedi TAU_HOURS):
        #   v(t) = v_ideal + (v_now − v_ideal) · exp(−t/τ)
        # Integrale da 0 a hours_to_reset:
        #   ∫v dt = v_ideal · h + (v_now − v_ideal) · τ · (1 − exp(−h/τ))
        # Quando τ → 0 (adattamento immediato) ⇒ projection = usage + v_ideal·h ≈ SAFE_TARGET.
        # Quando τ → ∞ (nessun adattamento) ⇒ projection = projection_naive.
        delta_v = velocity_smooth - velocity_ideal
        decay = math.exp(-hours_to_reset / TAU_HOURS) if TAU_HOURS > 0 else 0.0
        adapted_increase = velocity_ideal * hours_to_reset + delta_v * TAU_HOURS * (1 - decay)
        projection = usage + adapted_increase

    # Dead-band: la velocity smoothed sta calando rispetto al sample
    # precedente? Se sì, il sistema sta già rientrando: il notifier
    # userà questo flag per NON escalare il livello di throttle anche
    # quando projection > 95 — evita la frusta "rallenta-rallenta-
    # rallenta" mentre il team si sta già adattando.
    vs_prev = (last or {}).get("velocity_smooth")
    if isinstance(vs_prev, (int, float)) and abs(vs_prev) > 1e-3:
        velocity_decreasing = velocity_smooth < vs_prev - 0.5
    else:
        velocity_decreasing = False

    reset_event = bool(last and usage < (last.get("usage") or 0) - 30)

    # Burst filter: se nell'ultima ora il carico REALE accumulato e' basso
    # (< 8% cumulativo), proiezioni alte sono artefatti di un burst breve
    # extrapolato linearmente. Usiamo il delta cumulativo orario come
    # "verita' empirica" e sovrascriviamo la proiezione con una stima piu'
    # conservativa basata sulla velocita' media reale osservata.
    last_hour_delta = cumulative_delta_last_hour(history + [{"ts": ts, "delta": delta}], now)
    is_burst_artifact = (
        projection is not None and projection > 100
        and last_hour_delta < 8.0  # soglia empirica: meno di 8% di crescita in 1h
        and hours_to_reset and hours_to_reset > 0
    )
    if is_burst_artifact:
        # Rimpiazza projection con extrapolation basata sulla media reale
        # osservata nell'ultima ora (o fallback a velocity_ideal).
        realistic_vel = last_hour_delta  # %/h (delta cumulativo in 1h)
        projection = usage + max(realistic_vel, velocity_ideal or 0) * hours_to_reset

    # Finestra ottimale: projection ∈ [85, 95].
    # Sopra 95 → stiamo bruciando troppo, avvisare (RALLENTA).
    # Sotto 85 → stiamo sottoutilizzando, avvisare (SPINGI).
    # Tra 85 e 95 → OK, silenzio.
    # L'avviso host viene applicato in notify_capitano_if_needed.
    if reset_event:
        status, throttle = "RESET", 0
    elif projection is not None and projection > PROJ_HIGH:
        status, throttle = "ATTENZIONE", 1
    elif projection is not None and projection < PROJ_LOW:
        status, throttle = "SOTTOUTILIZZO", 0
    else:
        status, throttle = "OK", 0

    host = read_host_resources()
    host_level = host_pressure_level(host)

    return {
        "ts": ts,
        "provider": parsed.get("provider", "openai"),
        "usage": usage,
        "delta": round(delta, 2),
        "velocity": round(velocity, 2),
        "velocity_smooth": round(velocity_smooth, 2),
        "velocity_ideal": round(velocity_ideal, 2) if velocity_ideal is not None else None,
        "projection": round(projection, 2) if projection is not None else None,
        "projection_naive": round(projection_naive, 2) if projection_naive is not None else None,
        "velocity_decreasing": velocity_decreasing,
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


## ─── Edge-triggered policy: bridge → Capitano direct ───────────────

STATE_FILE = LOGS_DIR / "sentinel-policy-state.json"

# Descrizione umana dei livelli throttle. Capitano riceve queste frasi
# cosi' sa esattamente cosa fare senza calcolare lui le soglie. Le
# stringhe sono parte del protocollo tra bridge e Capitano (stabili).
THROTTLE_MEANING = {
    0: "OK",
    1: "ATTENZIONE",
}


def load_policy_state():
    try:
        with STATE_FILE.open(encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_policy_state(state):
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except OSError:
        pass


# ─── Watchdog: sentinella di sicurezza quando il bridge non vede l'API ───
#
# Reintrodotta su richiesta di Leone (2026-04-25) ma in forma degraded-mode
# anziché ruolo agente separato: la sentinella LLM autonoma sarebbe duplicata
# rispetto al bridge deterministico (ora già stabile post-2aea9235). Quando
# però l'API risponde 429 persistente o nessun fetch va a buon fine per N
# tick, il bridge non può più dire al Capitano che cosa sta succedendo —
# qui l'unico modo sicuro è notificare al Capitano "API DEGRADED, fai
# fallback con check_usage.py / rate_budget.py live" e fargli decidere.
#
# Una sola notifica per episodio (idempotente via flag in policy state),
# auto-clear quando torna a fluire.

FETCH_FAIL_THRESHOLD = 3  # tick consecutivi prima di alert (≈ 15 min con base 5m)


def record_fetch_failure(reason, capitano_session=None):
    """Incrementa il contatore di fetch falliti consecutivi. Se supera la
    soglia, invia un singolo BRIDGE ALERT al Capitano con istruzioni di
    fallback. Idempotente: il flag `degraded_alerted` impedisce ripetizioni.
    """
    state = load_policy_state()
    fails = int(state.get("fetch_fails_consecutive", 0) or 0) + 1
    state["fetch_fails_consecutive"] = fails
    state["last_fetch_fail_reason"] = reason
    if fails >= FETCH_FAIL_THRESHOLD and not state.get("degraded_alerted"):
        msg = (
            f"[BRIDGE ALERT] API DEGRADED — {fails} fetch consecutivi falliti "
            f"({reason}). Il grafico usage non si aggiorna. Fallback consigliati:\n"
            f"  • python3 /app/shared/skills/rate_budget.py live   (chiamata API on-demand)\n"
            f"  • python3 /app/shared/skills/check_usage.py        (TUI fallback via WORKER tmux)\n"
            f"Decidi tu se aspettare o ridurre il throttle preventivamente."
        )
        if capitano_session and session_exists(capitano_session):
            jht_tmux_send(capitano_session, msg)
        state["degraded_alerted"] = True
        state["degraded_since_ts"] = datetime.now(timezone.utc).isoformat()
    save_policy_state(state)


def record_fetch_success():
    """Reset contatore. Se eravamo in degraded e ora l'API risponde di
    nuovo, manda un singolo messaggio di "ripristino" al Capitano (utile
    perché potrebbe avere già rallentato preventivamente)."""
    state = load_policy_state()
    was_alerted = bool(state.get("degraded_alerted"))
    state["fetch_fails_consecutive"] = 0
    state["last_fetch_fail_reason"] = None
    state["degraded_alerted"] = False
    state["degraded_since_ts"] = None
    save_policy_state(state)
    return was_alerted


def _reset_human(reset_hhmm):
    """Da 'HH:MM' (UTC, come scritto dal bridge) a 'in 2h 43m' — il
    remaining e' l'unica metrica senza ambiguita' di timezone. Piu'
    utile all'LLM del Capitano che deve decidere "posso spingere?"
    rispetto all'ora dell'orologio.
    """
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    total_min = int((target - now).total_seconds() // 60)
    if total_min < 0:
        return None
    h_rem, m_rem = divmod(total_min, 60)
    return f"in {h_rem}h {m_rem}m" if h_rem > 0 else f"in {m_rem}m"


def policy_reason(entry):
    """Breve motivazione leggibile da mettere nell'ordine al Capitano.

    Note sul display del reset: il reset_at e' in UTC (bridge usa
    datetime.astimezone su TZ container=UTC). Mostrare solo "HH:MM"
    e' ambiguo per utenti in fuso locale diverso (es. "13:49" UTC
    letto come 13:49 CEST sbaglia il remaining di 2h). Usiamo il
    formato "in Xh Ym" che e' univoco per tutti.
    """
    status = entry.get("status", "?")
    proj = entry.get("projection")
    host_level = entry.get("host_level", "OK")
    usage = entry.get("usage")
    bits = [f"status={status}"]
    if usage is not None:
        bits.append(f"usage={usage}%")
    if proj is not None:
        bits.append(f"projection={proj}%")
    reset_remaining = _reset_human(entry.get("reset_at"))
    if reset_remaining:
        bits.append(f"reset_{reset_remaining}")
    if host_level not in ("OK", None):
        host = entry.get("host") or {}
        bits.append(f"host={host_level} (cpu={host.get('cpu_pct', '?')}% ram={host.get('ram_pct', '?')}%)")
    return " ".join(bits)


def _resolve_zone(_prev_zone, projection):
    """Zona pura dalla proiezione, niente isteresi. Il flap sui boundary
    è comunque filtrato dal notify on-change (escalation con dwell).
    Il `_prev_zone` resta nella firma per compat storica."""
    if projection is None:
        return "OK"
    if projection > PROJ_HIGH:
        return "HIGH"
    if projection < PROJ_LOW:
        return "LOW"
    return "OK"


def freeze_all_workers(exclude=("CAPITANO", "ASSISTENTE", "SENTINELLA-WORKER")):
    """Invia Esc × 2 a tutte le sessioni tmux degli agenti operativi per
    abortire i task in corso e congelare il team. Ultima spiaggia quando
    il Capitano non risponde in tempo alle escalations e si rischia di
    sforare la quota prima del reset.
    """
    try:
        r = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, timeout=5,
        )
        if r.returncode != 0:
            return []
        names = r.stdout.decode("utf-8", errors="replace").splitlines()
    except (subprocess.TimeoutExpired, OSError):
        return []

    frozen = []
    for name in names:
        name = name.strip()
        if not name or name in exclude:
            continue
        tmux_send_keys(name, "Escape")
        time.sleep(0.1)
        tmux_send_keys(name, "Escape")
        frozen.append(name)
    return frozen


def _compute_escalation_level(current_level, level_entered_iso, entry, now):
    """Determina il livello target (0-3) usando current + dwell + severity.

      0 = no alert; 1 = RALLENTA; 2 = STOP EXTRAS; 3 = FREEZE (auto-Esc).
    Dwell accelerato se reset < 30 min.

    Dead-band anti-oscillazione: se la velocity_smooth sta calando rispetto
    al sample precedente (`velocity_decreasing=True`), il sistema sta GIÀ
    rientrando e non bisogna escalare ulteriormente — l'escalation
    proseguirebbe nel ciclo "rallenta-rallenta-rallenta" anche dopo che il
    capitano ha già reagito. La severity override resta attiva (catastrofi
    veramente vicine al reset bypassano il dead-band).
    """
    projection = entry.get("projection") or 0
    usage = entry.get("usage") or 0
    velocity_decreasing = bool(entry.get("velocity_decreasing"))
    hours_to_reset = hours_until(entry.get("reset_at"))
    if hours_to_reset is None:
        hours_to_reset = 999.0

    level_entered = _parse_ts(level_entered_iso) if level_entered_iso else None
    time_in_level_min = (now - level_entered).total_seconds() / 60 if level_entered else 0

    accel = hours_to_reset < 0.5
    dwell_12 = 4 if accel else 8
    dwell_23 = 3 if accel else 6

    new_level = max(current_level, 1)
    if velocity_decreasing:
        # Sistema in rientro: tieni il livello corrente, lascia che il
        # throttle già imposto faccia effetto. Saltiamo dwell-based escalation.
        new_level = max(current_level, 1)
    else:
        if current_level == 1 and time_in_level_min >= dwell_12:
            new_level = 2
        elif current_level == 2 and time_in_level_min >= dwell_23:
            new_level = 3

    # Severity override (situazione drammatica → salta livelli, ignora dead-band)
    if hours_to_reset < 0.25 and projection > 110:
        new_level = 3
    elif hours_to_reset < 0.5 and (projection > 120 or usage > 85):
        new_level = max(new_level, 2)

    return new_level


def _build_high_message(level, projection, usage, reset_in, time_in_level_min, frozen_list):
    """Messaggio operativo. Finestra target 85-95, soglia superiore 95."""
    if level == 1:
        return (
            f"⬆ RALLENTA — projection {projection}% oltre 95 "
            f"(usage {usage}%, reset {reset_in}). Riduci il ritmo: allunga gli sleep, "
            f"non spawnare nuovi agenti. Target di rientro: 85-95. "
            f"Ti ricontatto solo se non rientri."
        )
    if level == 2:
        return (
            f"⛔ STOP EXTRAS — projection {projection}% non rientra sotto 95 dopo "
            f"~{time_in_level_min:.0f} min (usage {usage}%, reset {reset_in}). "
            f"Ferma subito gli agenti non-essenziali (tieni 1 sola istanza per ruolo critico)."
        )
    frozen_str = ", ".join(frozen_list) if frozen_list else "nessuno"
    return (
        f"🧊 FREEZE EMERGENZA — projection {projection}% non rientra "
        f"(usage {usage}%, reset {reset_in}). Ho inviato Esc a tutti gli agenti operativi "
        f"({frozen_str}). Aspetta il reset, non spawnare nulla."
    )


def notify_capitano_if_needed(entry, capitano_session="CAPITANO"):
    """Notifica il Capitano con escalation graduale a livelli.

      HIGH zone (projection > 95):
        level 1  RALLENTA (soft)                   — una volta sola
        level 2  STOP EXTRAS                       — se non rientra dopo ~8m
        level 3  FREEZE auto (Esc agenti)          — se non rientra dopo ~6m
        Dwell dimezzati se reset < 30 min. Severity override: se reset
        imminente + proiezione molto alta, saltiamo livelli.

      LOW zone → avviso una tantum (transizione)
      host HIGH/CRITICAL → accoda in coda al messaggio
      Recovery da escalation → messaggio "✅ rientrata, escalation rimossa"

    Il Capitano è intelligente: un ordine è sufficiente, non lo inondiamo
    di messaggi identici. Re-alert solo se la situazione peggiora.
    """
    state = load_policy_state()
    prev_zone = state.get("zone", "OK")
    projection = entry.get("projection")
    usage = entry.get("usage")
    host_level = entry.get("host_level", "OK")
    host = entry.get("host") or {}

    zone = _resolve_zone(prev_zone, projection)
    host_alert = host_level in ("HIGH", "CRITICAL")
    reset_in = _reset_human(entry.get("reset_at")) or "?"

    # ─── HIGH zone: escalation state machine ───────────────────────────
    if zone == "HIGH":
        now = _parse_ts(entry.get("ts")) or datetime.now(timezone.utc)
        prev_level = int(state.get("escalation_level", 0) or 0)
        prev_entered = state.get("level_entered_at")
        new_level = _compute_escalation_level(prev_level, prev_entered, entry, now)
        if prev_level == 0:
            new_level = max(new_level, 1)

        level_changed = new_level != prev_level
        frozen: list[str] = []
        if level_changed and new_level == 3:
            frozen = freeze_all_workers()

        level_entered_iso = now.isoformat() if level_changed else (prev_entered or now.isoformat())
        level_entered_dt = _parse_ts(level_entered_iso)
        time_in_level_min = (
            (now - level_entered_dt).total_seconds() / 60 if level_entered_dt else 0
        )

        state.update({
            "zone": "HIGH",
            "host_level": host_level,
            "status": entry.get("status"),
            "throttle": 1,
            "escalation_level": new_level,
            "level_entered_at": level_entered_iso,
        })

        if not level_changed:
            save_policy_state(state)
            return False

        msg_core = _build_high_message(
            new_level, projection, usage, reset_in, time_in_level_min, frozen
        )
        host_str = (
            f" · 💻 host={host_level} cpu={host.get('cpu_pct', '?')}% ram={host.get('ram_pct', '?')}%"
            if host_alert else ""
        )
        msg = f"[BRIDGE ORDER] {msg_core}{host_str}"

        if session_exists(capitano_session):
            jht_tmux_send(capitano_session, msg)
        state["last_notified_at"] = entry.get("ts")
        state["last_message"] = msg
        save_policy_state(state)
        return True

    # ─── Fuori HIGH: reset escalation se era attiva, notifica transizioni ───
    prev_level = int(state.get("escalation_level", 0) or 0)
    escalation_recovered = prev_level > 0
    state.update({
        "zone": zone,
        "host_level": host_level,
        "status": entry.get("status"),
        "throttle": 0,
        "escalation_level": 0,
        "level_entered_at": None,
    })

    parts: list[str] = []
    if escalation_recovered:
        parts.append(
            f"✅ projection {projection}% rientrata (usage {usage}%, reset {reset_in}) — "
            f"escalation rimossa, procedi col piano"
        )
    elif zone == "LOW" and prev_zone != "LOW":
        parts.append(
            f"⬇ projection {projection}% sotto zona target 85-95 (usage {usage}%, reset {reset_in}) — "
            f"SPINGI il team, quota residua"
        )
    if host_alert:
        parts.append(
            f"💻 host={host_level} cpu={host.get('cpu_pct', '?')}% ram={host.get('ram_pct', '?')}% — "
            f"alleggerisci / freeze spawn non-essenziali"
        )

    if not parts:
        save_policy_state(state)
        return False

    msg = "[BRIDGE ORDER] " + " · ".join(parts)
    if session_exists(capitano_session):
        jht_tmux_send(capitano_session, msg)
    state["last_notified_at"] = entry.get("ts")
    state["last_message"] = msg
    save_policy_state(state)
    return True


# ─── Loop & sleep dinamico ───────────────────────────────────────────

# Regex dei nomi di sessione tmux che contano come "team at work".
# Escludiamo CAPITANO / ASSISTENTE perche' sono sempre vivi anche a riposo,
# includiamo i ruoli operativi spawnati dal Capitano per i job.
WORKING_SESSION_PATTERN = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CRITICO)(-\d+)?$")


def count_working_sessions():
    """Numero di sessioni tmux di agenti operativi attivi."""
    try:
        r = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, timeout=5,
        )
        if r.returncode != 0:
            return 0
        names = r.stdout.decode("utf-8", errors="replace").splitlines()
        return sum(1 for n in names if WORKING_SESSION_PATTERN.match(n.strip()))
    except (subprocess.TimeoutExpired, OSError):
        return 0


def _zone_of(projection):
    """HIGH / TARGET / LOW a partire dal valore di projection.
    None se projection non disponibile."""
    if projection is None:
        return None
    if projection > PROJ_HIGH:
        return "HIGH"
    if projection < PROJ_LOW:
        return "LOW"
    return "TARGET"


def _parse_ts(ts_str):
    try:
        return datetime.fromisoformat(ts_str)
    except (TypeError, ValueError):
        return None


STATE_WINDOW_MINUTES = 10   # finestra su cui valutare stabilità/oscillazione


def classify_state(entry, history):
    """Classifica lo stato del flusso negli ultimi STATE_WINDOW_MINUTES:

      CRITICAL     — usage >= 85% o host HIGH/CRITICAL (rate-limit/host a muro)
      OSCILLATING  — la projection ha toccato 2+ zone (HIGH/TARGET/LOW)
                     all'interno della finestra → ritmo non stabile
      STABLE       — tutta la finestra è in una sola zona

    Ritorna ("STATE", "reason stringa breve per il log").

    Il criterio "oscillante" copre esattamente il caso dell'utente:
      - projection passa da 95→100+ (TARGET↔HIGH) → OSCILLATING
      - projection passa da 85→80 (TARGET↔LOW) → OSCILLATING
      - projection resta in [85,95] per 10 min interi → STABLE
      - projection resta sempre sopra 95 per 10 min → STABLE (in zona HIGH ma stabile)
        (il bridge ha gia' spedito l'ordine RALLENTA, polling può rallentare:
         non serve urgenza — è già sotto controllo del Capitano)
    """
    if not entry:
        return ("STABLE", "no data")

    usage = entry.get("usage") or 0
    host_level = entry.get("host_level") or "OK"
    if usage >= 85:
        return ("CRITICAL", f"usage {usage}%>=85")
    if host_level in ("HIGH", "CRITICAL"):
        return ("CRITICAL", f"host={host_level}")

    # Finestra: tutti i sample degli ultimi STATE_WINDOW_MINUTES + quello corrente.
    entry_ts = _parse_ts(entry.get("ts")) or datetime.now(timezone.utc)
    cutoff = entry_ts - timedelta(minutes=STATE_WINDOW_MINUTES)
    window = [entry]
    for e in (history or []):
        ts = _parse_ts(e.get("ts"))
        if ts and ts >= cutoff:
            window.append(e)

    zones = {_zone_of(e.get("projection")) for e in window}
    zones.discard(None)
    if len(zones) >= 2:
        return ("OSCILLATING", f"zones={sorted(zones)} in {STATE_WINDOW_MINUTES}m")
    only = next(iter(zones)) if zones else "UNKNOWN"
    return ("STABLE", f"zone={only} da {STATE_WINDOW_MINUTES}m")


def compute_next_tick(entry, user_tick, history=None):
    """Adaptive polling interval.

      CRITICAL    → 1 min  (serviamo alert rapidi)
      OSCILLATING → 3 min  (zona in movimento, servono dati vicini)
      STABLE      → 5 min  (flusso fermo, meno hit sull'API — default)

    `user_tick` (sentinella_tick_minutes) resta come floor: se l'utente
    chiede >= 5 min anche in zona critica (setup conservativi), onoriamo.
    Tipicamente è 0 e l'adaptive governa con base 5 min.

    Razionale: l'endpoint /api/oauth/usage di Anthropic rate-limita
    aggressivamente (bug noto gh anthropics/claude-code#30930). Polling
    ogni 1 min ha causato burst 429 → 5 min di blackout grafico. La
    base STABLE a 5 min è il default sicuro chiesto da Leone (2026-04-25).
    """
    if not entry:
        return max(1, min(user_tick or 5, 5))

    state, _reason = classify_state(entry, history)
    base = {"CRITICAL": 1, "OSCILLATING": 3, "STABLE": 5}[state]
    return max(base, user_tick or 0)


def sleep_with_poll(target_min):
    """Sleep up to target_min minutes, rileggendo il config ogni POLL_SECONDS
    per permettere modifiche in-flight (es. utente cambia tick_minutes,
    stato escalata a CRITICO in un altro tick). Se il nuovo target e'
    inferiore all'elapsed, esci subito.
    """
    total_sec = target_min * 60
    elapsed = 0
    current = target_min
    while elapsed < total_sec:
        time.sleep(min(POLL_SECONDS, total_sec - elapsed))
        elapsed += POLL_SECONDS
        fresh_user_tick, _ = read_config()
        if fresh_user_tick != current:
            new_total = fresh_user_tick * 60
            if elapsed >= new_total:
                return
            total_sec = new_total
            current = fresh_user_tick


PID_FILE = LOGS_DIR / "sentinel-bridge.pid"


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def acquire_singleton_lock():
    """Esci se c'e' gia' un'altra istanza del bridge viva.

    Bug osservato: ogni restart del Capitano via start-agent.sh spawnava un
    nuovo bridge senza killare i precedenti → accumulo di N istanze (fino a
    11 in un caso reale) che:
      - scrivono nel JSONL in parallelo (sample fantasma / timestamp duplicati)
      - aggiornano il policy state file in race → notify edge-detection rotta
      - pollano il provider in parallelo (consumo rate raddoppiato/triplicato)

    Lock via PID file: se esiste e il PID e' ancora vivo → esci. Altrimenti
    sovrascrivi col mio PID. Best-effort, OK se non riusciamo a scrivere.
    """
    try:
        if PID_FILE.exists():
            old_pid = int(PID_FILE.read_text(encoding="utf-8").strip() or "0")
            if old_pid and old_pid != os.getpid() and _pid_alive(old_pid):
                print(f"[sentinel-bridge] another instance running (pid={old_pid}), exit")
                sys.exit(0)
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except (OSError, ValueError):
        pass  # non siamo in grado di fare lock → proseguiamo, caso limite


SENTINELLA_SESSION = "SENTINELLA"
SENTINEL_HEALTH_SCRIPT = "/app/shared/skills/sentinel_health.py"
TICK_INTERVAL_MIN = 5  # fisso post-rifattorizzazione (era adattivo 1/3/5)


def _ensure_sentinella_alive():
    """Chiama sentinel_health.py per garantire che la Sentinella esista.

    Output ammessi:
      'running'                          → ok
      'restarted reason=...'             → ho appena rispawnato
      'fatal reason=...'                 → unrecoverable (ritorna None)
    Ritorna ('running'|'restarted'|None, dettaglio_per_log).
    """
    if not Path(SENTINEL_HEALTH_SCRIPT).exists():
        return None, "skill_missing"
    try:
        r = subprocess.run(
            ["python3", SENTINEL_HEALTH_SCRIPT, "ensure"],
            capture_output=True, timeout=15,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        return None, f"skill_error:{e}"
    out = r.stdout.decode("utf-8", errors="replace").strip()
    err = r.stderr.decode("utf-8", errors="replace").strip()
    if r.returncode != 0:
        return None, err or "skill_fatal"
    if out.startswith("running"):
        return "running", out
    if out.startswith("restarted"):
        return "restarted", out
    return None, out or "unknown_skill_response"


def main():
    """Bridge clock semplificato (post-rifattorizzazione 2026-04-25).

    Architettura nuova decisa con Leone:
      • il bridge NON fa più fetch API / calcoli / escalation.
      • ogni TICK_INTERVAL_MIN minuti:
          1) verifica che la sessione SENTINELLA sia viva (sentinel_health.py)
             - se morta, sentinel_health la rispawna automaticamente
             - se irrecuperabile, manda warning al Capitano
          2) invia un breve [BRIDGE TICK] alla SENTINELLA, che eseguirà
             le sue skill (rate_budget live + fallback worker tmux) e
             scriverà il sample nel JSONL con source=sentinella-*
      • il Capitano ha la sua skill rate_budget live (auto-record con
        source=capitano) e la usa a sua discrezione dopo gli spawn.

    Vantaggi rispetto al bridge precedente:
      • zero rischio di timeout API (non chiama nessuna API)
      • robustezza: se Sentinella muore, viene resuscitata; se non
        riparte, il Capitano è informato e si arrangia con la sua skill
      • singola responsabilità: ORA il bridge è un cron, non un cervello
    """
    acquire_singleton_lock()
    print(f"[sentinel-bridge] CLOCK MODE — target sentinella={SENTINELLA_SESSION}, "
          f"capitano={TARGET_SESSION} (pid={os.getpid()})")
    print(f"[sentinel-bridge] tick interval: {TICK_INTERVAL_MIN} min")

    sentinella_was_recovered = False  # per messaggio una-tantum al capitano
    while True:
        now_h = datetime.now().strftime("%H:%M:%S")

        health, detail = _ensure_sentinella_alive()
        if health is None:
            # Sentinella irrecuperabile: avvisa il Capitano una sola volta
            # per "episodio" e prosegui (lui avrà rate_budget per i suoi
            # check autonomi). Quando torna recuperabile, manda recovery.
            if not sentinella_was_recovered:
                if session_exists(TARGET_SESSION):
                    jht_tmux_send(
                        TARGET_SESSION,
                        f"[BRIDGE ALERT] Sentinella morta e non recuperabile ({detail}). "
                        "Continua i tuoi check autonomi via rate_budget live "
                        "finché non riparte (il prossimo `start-agent.sh sentinella` la rimette su)."
                    )
                sentinella_was_recovered = True
                print(f"[sentinel-bridge] {now_h} — sentinella FATAL ({detail}), Capitano avvisato, skip tick")
            else:
                print(f"[sentinel-bridge] {now_h} — sentinella ancora ko ({detail}), skip tick silenzioso")
            time.sleep(TICK_INTERVAL_MIN * 60)
            continue

        # Sentinella viva (o appena rispawnata): se ero in stato "fatal",
        # segnala recovery al Capitano una volta sola.
        if sentinella_was_recovered:
            sentinella_was_recovered = False
            if session_exists(TARGET_SESSION):
                jht_tmux_send(
                    TARGET_SESSION,
                    "[BRIDGE INFO] Sentinella tornata viva, monitoraggio ripreso."
                )

        # Manda il TICK alla Sentinella. Il messaggio è breve apposta:
        # la Sentinella sa già cosa fare (vedi suo prompt).
        if health == "restarted":
            print(f"[sentinel-bridge] {now_h} — sentinella RESTARTED ({detail}), invio tick")
        else:
            print(f"[sentinel-bridge] {now_h} — sentinella OK, invio tick")

        if session_exists(SENTINELLA_SESSION):
            jht_tmux_send(
                SENTINELLA_SESSION,
                f"[BRIDGE TICK] {now_h} — esegui il check usage come da tuo prompt."
            )

        time.sleep(TICK_INTERVAL_MIN * 60)


def _legacy_main_unused():
    """Versione precedente del main loop, conservata come riferimento.
    NON viene chiamata. Eliminabile in un cleanup successivo."""
    claude_api_ok_streak = 0
    while True:
        tick_min, provider = read_config()
        now_h = datetime.now().strftime("%H:%M:%S")

        if provider in ("kimi", "moonshot"):
            parsed = fetch_kimi_api()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_kimi_api fallito (token scaduto? no rete?)")
                record_fetch_failure("kimi_api_none", capitano_session=TARGET_SESSION)
                # Sleep fino al prossimo tick intero. Prima qui c'era
                # min(POLL_SECONDS, tick_min*60) → con tick_min=1 faceva
                # retry ogni 15s. L'endpoint /api/oauth/usage di Anthropic
                # ha un suo rate-limit: ripeterlo 4x al minuto ci faceva
                # beccare 429 cascading. Aspettare il tick pieno dà margine.
                time.sleep(tick_min * 60)
                continue
        elif provider in ("anthropic", "claude"):
            parsed = fetch_claude_api()
            if parsed in ("RATE_LIMIT", None):
                reason = "429" if parsed == "RATE_LIMIT" else "token/rete"
                claude_api_ok_streak = 0

                # Lazy-spawn del WORKER: se non c'è, creane uno; il boot dura
                # ~10s, quindi al primo tick dopo lo spawn la query fallirà.
                # Dal tick successivo in poi il WORKER risponde a /usage.
                if not worker_alive():
                    if spawn_claude_worker():
                        print(f"[sentinel-bridge] {now_h} — claude API {reason}, spawn WORKER (sarà pronto al prossimo tick)")

                # Fallback: solo sorgenti LIVE, mai cache come sample.
                # Usare la cache come sample "ts=now" causa uno spike di
                # velocity al prossimo fetch reale (12s tra cache stantia
                # e dato vero → delta enorme). Meglio un buco onesto nel
                # grafico che un artefatto che fa sparare proj a 300%.
                worker = query_claude_worker()
                if worker is not None:
                    parsed = worker
                    print(f"[sentinel-bridge] {now_h} — claude API {reason}, fallback WORKER: usage={parsed.get('usage')}%")
                else:
                    passive = fetch_claude_tui(TARGET_SESSION)
                    if passive is not None:
                        parsed = passive
                        print(f"[sentinel-bridge] {now_h} — claude API {reason}, fallback TUI passivo (CAPITANO): usage={parsed.get('usage')}%")
                    else:
                        print(f"[sentinel-bridge] {now_h} — claude API {reason}, WORKER non ancora pronto, nessun fallback live — skip tick")
                        record_fetch_failure(f"claude_{reason}_no_fallback", capitano_session=TARGET_SESSION)
                        time.sleep(tick_min * 60)
                        continue
            else:
                # API OK: incrementa streak; dopo 2 tick consecutivi puliamo
                # il worker se ancora in piedi (liberiamo RAM e 1 slot di
                # sessione claude concurrent). 2 e non 1 per evitare flap
                # spawn/kill se il 429 oscilla.
                claude_api_ok_streak += 1
                if claude_api_ok_streak >= 2 and worker_alive():
                    kill_worker()
                    print(f"[sentinel-bridge] {now_h} — claude API stabile, WORKER terminato (liberata la sessione fallback)")
        elif provider in ("openai",):
            parsed = fetch_codex_rollout()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_codex_rollout fallito (nessuna sessione codex attiva?)")
                record_fetch_failure("codex_rollout_none", capitano_session=TARGET_SESSION)
                # Sleep fino al prossimo tick intero. Prima qui c'era
                # min(POLL_SECONDS, tick_min*60) → con tick_min=1 faceva
                # retry ogni 15s. L'endpoint /api/oauth/usage di Anthropic
                # ha un suo rate-limit: ripeterlo 4x al minuto ci faceva
                # beccare 429 cascading. Aspettare il tick pieno dà margine.
                time.sleep(tick_min * 60)
                continue
        else:
            print(f"[sentinel-bridge] {now_h} — provider '{provider}' non supportato, skip")
            time.sleep(min(POLL_SECONDS, tick_min * 60))
            continue

        # Fetch riuscito: reset watchdog. Se eravamo in degraded, segnalo
        # al Capitano che l'API è tornata responsiva (utile perché potrebbe
        # avere già rallentato preventivamente).
        was_alerted = record_fetch_success()
        if was_alerted and session_exists(TARGET_SESSION):
            jht_tmux_send(
                TARGET_SESSION,
                "[BRIDGE INFO] API tornata responsiva, grafico usage si aggiorna di nuovo. "
                "Puoi tornare al ritmo normale se avevi rallentato preventivamente."
            )
        parsed["provider"] = provider

        last = load_last_sample()
        # Provider switch guard: se l'ultimo sample era di un provider diverso
        # (es. utente cambia da kimi a openai), le scale di usage sono
        # indipendenti e il delta sarebbe un artefatto (kimi=1% → openai=49%
        # appare come delta=+48%, velocity=777, projection=508%). Invalida
        # last e history come se fosse un boot pulito per il nuovo provider.
        if last and last.get("provider") != provider:
            last = None
            history = []
        else:
            history = load_recent_samples(30)
        entry = compute_metrics(parsed, last, history=history)
        write_jsonl(entry)
        write_log(entry)
        notified = notify_capitano_if_needed(entry, capitano_session=TARGET_SESSION)
        notif_hint = " [ORDER SENT]" if notified else ""

        next_tick = compute_next_tick(entry, tick_min, history=history)
        state_label, state_reason = classify_state(entry, history)

        print(
            f"[sentinel-bridge] {now_h} — usage={entry['usage']}% "
            f"status={entry['status']} t={entry['throttle']} "
            f"projection={entry.get('projection') or '-'} "
            f"[{state_label}: {state_reason}] (next in {next_tick}m){notif_hint}"
        )
        sleep_with_poll(next_tick)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[sentinel-bridge] interrotto.")
        sys.exit(0)
