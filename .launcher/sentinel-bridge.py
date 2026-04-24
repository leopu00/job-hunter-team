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


def fetch_claude_api():
    """
    Chiama direttamente https://api.anthropic.com/api/oauth/usage con
    OAuth token da ~/.claude/.credentials.json. Endpoint interno usato
    dal CLI claude per /usage; stabile, strutturato, zero TUI.

    Risposta:
      {
        "five_hour":      {"utilization": 47.0, "resets_at": "2026-..."},
        "seven_day":      {"utilization": 37.0, "resets_at": "..."},
        "seven_day_sonnet": {"utilization": 4.0,  "resets_at": "..."},
        "seven_day_opus":   null,
        ...
      }
    """
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
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, OSError):
        return None

    five_h = data.get("five_hour") or {}
    seven_d = data.get("seven_day") or {}
    try:
        usage_5h = int(round(float(five_h.get("utilization", 0))))
        weekly = int(round(float(seven_d.get("utilization", 0)))) if seven_d.get("utilization") is not None else None
    except (TypeError, ValueError):
        return None

    return {
        "usage": usage_5h,
        "reset_at": _iso_to_hhmm(five_h.get("resets_at")),
        "weekly_usage": weekly,
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
    if hours_to_reset and hours_to_reset > 0:
        velocity_ideal = max(0.0, (SAFE_TARGET - usage) / hours_to_reset)
        projection = usage + velocity_smooth * hours_to_reset

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

    # Throttle: dominato da USAGE ASSOLUTO, non dalla projection.
    # La projection e' speculativa (basata su EMA), il rate-limit reale
    # scatta solo all'usage assoluto. Se siamo al 60% con proiezione
    # 150%, non ha senso freezare — serve rallentare ma il Capitano deve
    # comunque lavorare (una nuova sessione inizia sempre col bridge in
    # stato dubbioso e deve poter osservare il consumo reale).
    #
    # Scala:
    #   usage >= 95%           → T4 freeze (rate-limit imminente)
    #   usage >= 88%           → T3 critico
    #   usage >= 75% + proj>100%→ T2 rallenta marcato
    #   proj > SAFE_TARGET     → T1 rallenta leggero
    #   default                → T0 full speed
    if reset_event:
        status, throttle = "RESET", 0
    elif usage >= 95:
        status, throttle = "CRITICO", 4
    elif usage >= 88:
        status, throttle = "CRITICO", 3
    elif usage >= 75 and projection is not None and projection > 100:
        status, throttle = "ATTENZIONE", 2
    elif projection is not None and projection > SAFE_TARGET and usage >= 40:
        status, throttle = "ATTENZIONE", 1
    elif usage < 30 and (projection is None or projection < 60):
        status, throttle = "SOTTOUTILIZZO", 0
    else:
        status, throttle = "OK", 0

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


## ─── Edge-triggered policy: bridge → Capitano direct ───────────────

STATE_FILE = LOGS_DIR / "sentinel-policy-state.json"

# Descrizione umana dei livelli throttle. Capitano riceve queste frasi
# cosi' sa esattamente cosa fare senza calcolare lui le soglie. Le
# stringhe sono parte del protocollo tra bridge e Capitano (stabili).
THROTTLE_MEANING = {
    0: "T0 full speed — nessun vincolo",
    1: "T1 — sleep 30s tra operazioni",
    2: "T2 — sleep 2 min tra operazioni",
    3: "T3 — sleep 5 min, freeze spawn non-essenziali",
    4: "T4 — freeze operativo totale, solo azioni core",
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


def notify_capitano_if_needed(entry, capitano_session="CAPITANO"):
    """Edge-triggered: invia al Capitano SOLO quando cambia la POLICY OPERATIVA.

    "Policy operativa" = (throttle, host_level). Questi DRIVE il
    comportamento del Capitano (spawn / pausa / freeze).

    NOTA BENE: il campo `status` (OK / SOTTOUTILIZZO / ATTENZIONE /
    CRITICO) NON e' incluso nel trigger perche' oscilla con facilita'
    attorno ai boundary (es. projection 58% vs 62% → OK vs SOTTOUTILIZZO)
    anche quando il throttle resta stabile a T0. In passato lo includevamo
    → il Capitano veniva massacrato da [BRIDGE ORDER] identici tranne
    per il tag status, mentre la direttiva operativa era la stessa.
    Lo status resta visibile nel grafico /team/sentinella ma non alerta.

    Il throttle e' gia' una funzione DETERMINISTICA di usage/projection
    con soglie ampie (0/75/88/95%) → cambia solo su transizioni reali.
    """
    state = load_policy_state()
    new_throttle = entry.get("throttle")
    new_host_level = entry.get("host_level", "OK")
    new_status = entry.get("status")

    changed = (
        state.get("throttle") != new_throttle
        or state.get("host_level") != new_host_level
    )
    if not changed:
        # Teniamo comunque lo status aggiornato nel state file per
        # coerenza con i log/dashboard; non triggera notifiche.
        if state.get("status") != new_status:
            state["status"] = new_status
            save_policy_state(state)
        return False

    meaning = THROTTLE_MEANING.get(new_throttle, f"T{new_throttle}")
    reason = policy_reason(entry)
    msg = f"[BRIDGE ORDER] {meaning} — {reason}"

    if session_exists(capitano_session):
        jht_tmux_send(capitano_session, msg)

    state.update({
        "throttle": new_throttle,
        "host_level": new_host_level,
        "status": new_status,
        "last_notified_at": entry.get("ts"),
        "last_message": msg,
    })
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


def compute_next_tick(entry, user_tick):
    """Calcola dinamicamente l'intervallo fino al prossimo poll.

    Il valore utente (sentinella_tick_minutes da jht.config.json) e'
    il TETTO usato a riposo: se il team e' fermo e tutto e' OK,
    non ha senso pollare piu' spesso.

    In pressione aumentiamo la frequenza perche' le transizioni
    (spawn burst, rate limit close, host saturazione) possono
    saltare da OK a CRITICO in pochi minuti:

      status CRITICO            →  1 min  (serviamo alert rapidi)
      host HIGH / CRITICAL      →  1 min  (PC saturo, stop urgente)
      status ATTENZIONE         →  3 min  (watch)
      team operativo attivo     →  3 min  (prevenzione)
      SOTTOUTILIZZO / OK + idle →  tetto utente (default 10 min)
    """
    status = entry.get("status") if entry else None
    host_level = entry.get("host_level") if entry else None
    working = count_working_sessions()

    if status == "CRITICO" or host_level in ("HIGH", "CRITICAL"):
        return 1
    if status == "ATTENZIONE":
        return min(3, user_tick)
    if working > 0:
        return min(3, user_tick)
    return user_tick


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


def main():
    print(f"[sentinel-bridge] target session: {TARGET_SESSION}")
    print(f"[sentinel-bridge] config: {CONFIG_PATH} (bootstrap: {BOOTSTRAP}m)")
    # Tutti i provider supportati hanno un canale di polling senza TUI:
    #   kimi/moonshot      HTTP /coding/v1/usages
    #   anthropic/claude   HTTP /api/oauth/usage
    #   openai/codex       rollout JSONL in ~/.codex/sessions/
    # Nessun fallback tmux necessario — se un provider non riconosciuto
    # finisce in config, loggiamo e andiamo avanti al prossimo tick.
    while True:
        tick_min, provider = read_config()
        now_h = datetime.now().strftime("%H:%M:%S")

        if provider in ("kimi", "moonshot"):
            parsed = fetch_kimi_api()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_kimi_api fallito (token scaduto? no rete?)")
                time.sleep(min(POLL_SECONDS, tick_min * 60))
                continue
        elif provider in ("anthropic", "claude"):
            parsed = fetch_claude_api()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_claude_api fallito (token scaduto? no rete?)")
                time.sleep(min(POLL_SECONDS, tick_min * 60))
                continue
        elif provider in ("openai",):
            parsed = fetch_codex_rollout()
            if parsed is None:
                print(f"[sentinel-bridge] {now_h} — fetch_codex_rollout fallito (nessuna sessione codex attiva?)")
                time.sleep(min(POLL_SECONDS, tick_min * 60))
                continue
        else:
            print(f"[sentinel-bridge] {now_h} — provider '{provider}' non supportato, skip")
            time.sleep(min(POLL_SECONDS, tick_min * 60))
            continue
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

        next_tick = compute_next_tick(entry, tick_min)

        print(
            f"[sentinel-bridge] {now_h} — usage={entry['usage']}% "
            f"status={entry['status']} t={entry['throttle']} "
            f"projection={entry.get('projection') or '-'} "
            f"(next in {next_tick}m){notif_hint}"
        )
        sleep_with_poll(next_tick)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[sentinel-bridge] interrotto.")
        sys.exit(0)
