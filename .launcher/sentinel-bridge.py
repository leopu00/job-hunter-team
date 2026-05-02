#!/usr/bin/env python3
"""
Sentinel Bridge V5 — orologio + fetch + tick alla Sentinella.

Architettura V5 (post-incident 2026-04-25):
  • ogni 5 min: fetch del provider attivo (codex JSONL / kimi HTTP / claude HTTP)
  • se OK: scrive sample con source=bridge nel JSONL (via skill compute_metrics
    + usage_record, source-aware), poi manda [BRIDGE TICK] alla SENTINELLA col
    dato fresco (usage/proj/status/reset).
  • se FAIL: manda [BRIDGE FAILURE] alla SENTINELLA che fa fallback (rate_budget
    live → check_usage). Al 3° fail consecutivo alert al Capitano.

Tutta la logica decisionale (throttle, ordine, freeze) è nella SENTINELLA LLM,
secondo il pattern Pasqua: ad ogni tick lei calcola velocità smussata, decide
stato, ordina al Capitano. Vedi agents/sentinella/sentinella.md.

Niente più nel bridge:
  ✗ escalation L1/L2/L3 (era V1, abbandonato)
  ✗ sentinel_health auto-restart (causava restart loop, V4 bug)
  ✗ filtro silenzioso "TACE è il default" (V4, fragile)
  ✗ τ-aware projection inline (calcolata dalla skill compute_metrics)

Le funzioni di fetch (fetch_kimi_api, fetch_claude_api, fetch_codex_rollout)
+ helper restano esposte come libreria importabile dalle skill (rate_budget,
usage_record, check_usage).

Config:
  active_provider in $JHT_HOME/jht.config.json — kimi / openai / claude
  JHT_TARGET_SESSION                              — capitano (default CAPITANO)
  JHT_HOME                                        — dir config (default ~/.jht)
"""

import importlib.util
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


# ── Costanti modulo ─────────────────────────────────────────────────────

CAPITANO_SESSION = os.environ.get("JHT_TARGET_SESSION", "CAPITANO")
SENTINELLA_SESSION = "SENTINELLA"

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
CONFIG_PATH = JHT_HOME / "jht.config.json"
LOGS_DIR = JHT_HOME / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
DATA_JSONL = LOGS_DIR / "sentinel-data.jsonl"
LOG_TXT = LOGS_DIR / "sentinel-log.txt"
PID_FILE = LOGS_DIR / "sentinel-bridge.pid"
# State pubblico letto dall'UI web (web/app/api/bridge/status/route.ts).
# Source-of-truth del prossimo tick: il bridge calcola e pubblica qui;
# la UI legge senza ricostruire la logica (che cambierebbe ogni V*).
STATE_FILE = LOGS_DIR / "sentinel-bridge-state.json"
STATE_VERSION = 6

DEFAULT_TICK_MINUTES = 5               # default se config mancante
MIN_TICK_SECONDS = 15                  # safety floor: <15s spammerebbe il provider
FETCH_FAIL_THRESHOLD = 3               # alert capitano dopo N fail consecutivi

# ── V6 Adaptive tick (state machine) ────────────────────────────────────
# Il bridge fa MONITORING. Notifica la Sentinella solo quando serve.
# Cadenza in funzione della stabilità della proiezione attorno al G-spot.
#
# G-spot = banda obiettivo: proj ∈ [80%, 105%]. Più ampio dello STEADY
# stretto (90-95%) calcolato da compute_metrics, perché in g-spot vogliamo
# anticipare sia l'uscita verso ATTENZIONE sia il drift verso SOTTOUTILIZZO
# senza bruciare LLM.
#
# Stati del tick interval:
#   DEFAULT        3 min   bootstrap o proj fuori g-spot (critico/sotto)
#   GSPOT_FAST     2 min   appena entrato nel g-spot, monitoring reattivo
#   GSPOT_STABLE   5 min   3 tick consecutivi nel g-spot
#   GSPOT_CALM    10 min   3 tick consecutivi a GSPOT_STABLE nel g-spot
#
# Quando proj esce dal g-spot → torna a DEFAULT (3 min) e reset counters.
DEFAULT_TICK_MIN = 3.0
GSPOT_FAST_TICK_MIN = 2.0
GSPOT_STABLE_TICK_MIN = 5.0
GSPOT_CALM_TICK_MIN = 10.0

GSPOT_LOWER = 80.0    # proj < 80% → sotto g-spot (sottoutilizzo)
GSPOT_UPPER = 105.0   # proj > 105% → sopra g-spot (critico)
GSPOT_PROMOTION_TICKS = 3  # tick consecutivi nel g-spot per promuovere stato

# ── Notifica Sentinella ──────────────────────────────────────────────────
# La Sentinella è SVEGLIATA solo quando la proj è fuori dal g-spot.
# Per evitare il loop autoindotto (Sentinella+Capitano consumano token →
# proj sale → Sentinella di nuovo svegliata), una volta notificata il bridge
# attende SENTINELLA_COOLDOWN_MIN prima di rinotificarla, anche se ancora
# critico. Quando proj rientra nel g-spot, il cooldown si resetta.
SENTINELLA_COOLDOWN_MIN = 15.0


# ── Config + tmux helpers (libreria per le skill) ───────────────────────

def read_config():
    """Ritorna (tick_override, provider). tick_override è il valore esplicito
    di sentinella_tick_minutes nel config (float, es. 0.5 = 30s) o None se
    non settato. Quando None, il bridge usa il tick adattivo in base allo
    stato dell'ultimo sample (vedi _choose_tick_interval)."""
    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            cfg = json.load(f)
        provider = cfg.get("active_provider") or "openai"
        raw_tick = cfg.get("sentinella_tick_minutes")
        tick_override = float(raw_tick) if isinstance(raw_tick, (int, float)) and raw_tick > 0 else None
        return tick_override, provider
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None, "openai"


def _is_in_gspot(proj):
    """True se proj ∈ [GSPOT_LOWER, GSPOT_UPPER]. Banda larga (80-105%)
    rispetto allo STEADY stretto di compute_metrics (90-95%): qui ci
    interessa "siamo nella zona buona", non "siamo perfettamente al target"."""
    if not isinstance(proj, (int, float)):
        return False
    return GSPOT_LOWER <= proj <= GSPOT_UPPER


def _choose_tick_interval(state, override_min=None):
    """Decide il prossimo tick interval in minuti basandosi sulla state
    machine del bridge V6.

    state è un dict con:
      tick_phase             — "DEFAULT" | "GSPOT_FAST" | "GSPOT_STABLE" | "GSPOT_CALM"
      gspot_consecutive      — n. tick consecutivi nel g-spot

    Override esplicito (config sentinella_tick_minutes) vince sempre.
    """
    if override_min is not None:
        return override_min
    phase = state.get("tick_phase", "DEFAULT")
    return {
        "DEFAULT": DEFAULT_TICK_MIN,
        "GSPOT_FAST": GSPOT_FAST_TICK_MIN,
        "GSPOT_STABLE": GSPOT_STABLE_TICK_MIN,
        "GSPOT_CALM": GSPOT_CALM_TICK_MIN,
    }.get(phase, DEFAULT_TICK_MIN)


def _advance_tick_phase(state, in_gspot):
    """Aggiorna state["tick_phase"] e state["gspot_consecutive"] in
    funzione del nuovo sample (in_gspot=bool).

    Promotion: 3 tick consecutivi in g-spot promuovono di livello.
    Demotion: appena un tick esce dal g-spot → reset a DEFAULT.
    """
    if not in_gspot:
        state["tick_phase"] = "DEFAULT"
        state["gspot_consecutive"] = 0
        return

    state["gspot_consecutive"] = state.get("gspot_consecutive", 0) + 1
    n = state["gspot_consecutive"]
    phase = state.get("tick_phase", "DEFAULT")

    if phase == "DEFAULT":
        # Appena entriamo nel g-spot, passiamo subito a FAST (2 min) per
        # confermare che non sia rumore.
        state["tick_phase"] = "GSPOT_FAST"
    elif phase == "GSPOT_FAST" and n >= GSPOT_PROMOTION_TICKS:
        state["tick_phase"] = "GSPOT_STABLE"
        state["gspot_consecutive"] = 0  # ricomincia a contare per CALM
    elif phase == "GSPOT_STABLE" and n >= GSPOT_PROMOTION_TICKS:
        state["tick_phase"] = "GSPOT_CALM"
        state["gspot_consecutive"] = 0  # nessuna ulteriore promozione, ma resta pulito


def _should_notify_sentinella(in_gspot, state, now_ts):
    """Decide se SVEGLIARE la Sentinella su questo tick.

    Regola: la Sentinella riceve TICK solo quando la proiezione è fuori dal
    g-spot (situazione che richiede un'azione). Una volta notificata, il
    bridge entra in cooldown SENTINELLA_COOLDOWN_MIN: anche se la situazione
    rimane critica, il bridge tace e la Sentinella+Capitano non consumano
    token in loop. Dopo il cooldown, se ancora fuori g-spot, rinotifica.

    Quando la proj rientra nel g-spot, il cooldown si resetta — così il
    prossimo episodio critico viene notificato subito.

    state è un dict con:
      last_sent_ts            — timestamp Unix dell'ultima notifica critica
                                (None se mai notificata)
    """
    if in_gspot:
        # In g-spot: nessun bisogno di Sentinella. Reset del cooldown così
        # il prossimo episodio critico è notificato immediatamente.
        state["last_sent_ts"] = None
        return False

    last_ts = state.get("last_sent_ts")
    if last_ts is None:
        # Primo tick fuori dal g-spot in questo episodio → notifica.
        return True
    elapsed_min = (now_ts - last_ts) / 60.0
    return elapsed_min >= SENTINELLA_COOLDOWN_MIN


def _write_state_file(state, last_tick_at, next_tick_at, tick_interval_min,
                      last_status=None, last_projection=None, last_usage=None):
    """Pubblica lo stato corrente del bridge in un JSON atomico letto dalla
    UI web (`/api/bridge/status`). Sostituisce la replica della logica
    `_choose_tick_interval` lato TS, che era fragile rispetto a cambi del
    bridge (V5→V6 aveva costanti diverse e il timer mostrato era sballato).

    Atomic write: scriviamo in `<file>.tmp` e poi `os.replace` per evitare
    letture parziali se il fetcher web colpisce a metà write.
    """
    payload = {
        "version": STATE_VERSION,
        "pid": os.getpid(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "last_tick_at": last_tick_at,
        "next_tick_at": next_tick_at,
        "tick_phase": state.get("tick_phase"),
        "tick_interval_min": tick_interval_min,
        "gspot_consecutive": state.get("gspot_consecutive", 0),
        "last_sentinella_notify_at": (
            datetime.fromtimestamp(state["last_sent_ts"], tz=timezone.utc).isoformat()
            if state.get("last_sent_ts") else None
        ),
        "last_status": last_status,
        "last_projection": last_projection,
        "last_usage": last_usage,
        "g_spot": {"lower": GSPOT_LOWER, "upper": GSPOT_UPPER},
        "sentinella_cooldown_min": SENTINELLA_COOLDOWN_MIN,
    }
    tmp = STATE_FILE.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp, STATE_FILE)
    except OSError as e:
        print(f"[bridge V6] WARN write state: {e}", file=sys.stderr)


def session_exists(s):
    return subprocess.run(["tmux", "has-session", "-t", s], capture_output=True).returncode == 0


def jht_tmux_send(session, text):
    return subprocess.run(["jht-tmux-send", session, text], capture_output=True, timeout=15).returncode == 0


# ── Codex: lettura rollout JSONL ────────────────────────────────────────

CODEX_SESSIONS_DIR = JHT_HOME / ".codex" / "sessions"


def fetch_codex_rollout():
    """Legge il rollout JSONL più recente sotto ~/.codex/sessions/ e
    estrae rate_limits.primary.used_percent + resets_at."""
    try:
        if not CODEX_SESSIONS_DIR.exists():
            return None
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

        # Con N sessioni codex parallele i rate_limits.primary.used_percent
        # letti dai rispettivi rollout sono discordanti (es. 14/20/20% nello
        # stesso 4s window) per quantizzazione e race lato server. La vecchia
        # logica prendeva il primo file per mtime e fermava → valore casuale
        # che oscilla. mtime si aggiorna anche per eventi tool_use/shell, non
        # solo per nuove risposte API: mtime fresco ≠ rate_limits fresco.
        # Fix: scorri tutti i candidati, raccogli i rate_limits più recenti,
        # filtra entro 60s dal più fresco per timestamp evento, prendi il MAX
        # di used_percent (safer per un budget rate-limit).
        all_rls = []
        for _, p in candidates:
            try:
                with p.open("rb") as f:
                    f.seek(0, os.SEEK_END)
                    size = f.tell()
                    f.seek(max(0, size - 200_000))
                    tail = f.read().decode("utf-8", errors="replace")
            except OSError:
                continue
            for line in reversed(tail.splitlines()[-300:]):
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
                all_rls.append((evt.get("timestamp") or "", rl))
                break

        if not all_rls:
            return None

        def _parse_iso(s):
            try:
                return datetime.fromisoformat(s.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                return None

        all_rls.sort(key=lambda x: x[0], reverse=True)
        newest_dt = _parse_iso(all_rls[0][0])
        if newest_dt is None:
            recent = all_rls[:1]
        else:
            recent = [
                (ts, rl) for ts, rl in all_rls
                if (dt := _parse_iso(ts)) is not None
                and (newest_dt - dt).total_seconds() <= 60
            ] or all_rls[:1]
        best_rl = max(
            recent,
            key=lambda x: float((x[1].get("primary") or {}).get("used_percent") or 0),
        )[1]
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
        return {"usage": usage, "reset_at": reset_at, "weekly_usage": weekly}
    except (OSError, json.JSONDecodeError):
        return None


# ── Claude: HTTP API + 429 cooldown ─────────────────────────────────────

CLAUDE_CREDENTIALS = JHT_HOME / ".claude" / ".credentials.json"
CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CLAUDE_429_COOLDOWN_FILE = LOGS_DIR / "claude-429-cooldown"
CLAUDE_429_COOLDOWN_S = 300


def _read_claude_token():
    try:
        with CLAUDE_CREDENTIALS.open(encoding="utf-8") as f:
            creds = json.load(f)
        return (creds.get("claudeAiOauth") or {}).get("accessToken")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _load_claude_429_cooldown():
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


def fetch_claude_api():
    """Ritorna dict {usage, reset_at, weekly_usage}, None, o 'RATE_LIMIT'."""
    global _claude_429_until
    if time.time() < _claude_429_until:
        return "RATE_LIMIT"
    token = _read_claude_token()
    if not token:
        return None
    req = urllib.request.Request(
        CLAUDE_USAGE_URL,
        headers={"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
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
    return {"usage": usage_5h, "reset_at": _iso_to_hhmm(five_h.get("resets_at")), "weekly_usage": weekly}


# ── Kimi: HTTP API ──────────────────────────────────────────────────────

KIMI_CREDENTIALS = JHT_HOME / ".kimi" / "credentials" / "kimi-code.json"
KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages"


def _read_kimi_token():
    try:
        with KIMI_CREDENTIALS.open(encoding="utf-8") as f:
            return json.load(f).get("access_token")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _iso_to_hhmm(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%H:%M")
    except (ValueError, TypeError):
        return None


def fetch_kimi_api():
    token = _read_kimi_token()
    if not token:
        return None
    req = urllib.request.Request(KIMI_USAGES_URL, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
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


# ── Storage I/O ─────────────────────────────────────────────────────────

def load_last_sample(source=None):
    """Ultimo sample dal JSONL, opzionalmente filtrato per source.
    Quando il bridge calcola velocità deve usare solo i propri sample
    (source='bridge'), altrimenti i sample ad-hoc del Capitano
    (rate_budget live) si infilano tra tick e fanno scattare anti-spike."""
    if not DATA_JSONL.exists():
        return None
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        if source is None:
            return json.loads(raw[-1]) if raw else None
        # Filtra per source: cerca dall'ultimo verso il primo
        for line in reversed(raw):
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue
            if s.get("source") == source:
                return s
        return None
    except (OSError, json.JSONDecodeError, IndexError):
        return None


def load_recent_samples(n=30, source=None):
    """Ultimi N sample dal JSONL, opzionalmente filtrati per source."""
    if not DATA_JSONL.exists():
        return []
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        out = []
        for line in raw:
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue
            if source is not None and s.get("source") != source:
                continue
            out.append(s)
        return out[-n:]
    except OSError:
        return []


def write_jsonl(entry):
    with DATA_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def write_log(entry):
    line = (
        f"[{entry['ts']}] provider={entry['provider']} "
        f"usage={entry['usage']}% "
        f"vel_smooth={entry.get('velocity_smooth', '-')}/h "
        f"proj={entry.get('projection', '-')}% "
        f"status={entry.get('status', '-')} src={entry.get('source', '-')}"
    )
    with LOG_TXT.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


# ── Singleton lock ──────────────────────────────────────────────────────

def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def acquire_singleton_lock():
    """Esci se un altro bridge è già vivo (PID file)."""
    try:
        if PID_FILE.exists():
            old_pid = int(PID_FILE.read_text(encoding="utf-8").strip() or "0")
            if old_pid and old_pid != os.getpid() and _pid_alive(old_pid):
                print(f"[bridge V5] altra istanza viva (pid={old_pid}), exit")
                sys.exit(0)
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except (OSError, ValueError):
        pass


# ── Helper: chiama compute_metrics skill per scrivere sample ────────────

def _compute_metrics_via_skill(parsed, last, history):
    """Path-import della skill compute_metrics per centralizzare il calcolo
    delle metriche derivate (velocity_smooth, projection τ-aware, status).
    Se la skill non esiste (config rotta), fallback a sample minimale."""
    skill_path = Path("/app/shared/skills/compute_metrics.py")
    if not skill_path.exists():
        skill_path = Path(__file__).resolve().parent.parent / "shared" / "skills" / "compute_metrics.py"
    if not skill_path.exists():
        # Fallback: sample minimale senza metriche derivate
        return {
            "ts": datetime.now(timezone.utc).isoformat(),
            "provider": parsed.get("provider"),
            "usage": parsed.get("usage"),
            "reset_at": parsed.get("reset_at"),
            "weekly_usage": parsed.get("weekly_usage"),
            "status": "OK",
        }
    spec = importlib.util.spec_from_file_location("compute_metrics", skill_path)
    cm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cm)
    return cm.compute_metrics(parsed, last, history=history)


# ── Claude TUI parser (libreria importata da check_usage) ──────────────

WORKER_SESSION = "SENTINELLA-WORKER"
START_AGENT_SH = "/app/.launcher/start-agent.sh"

# Mitigazioni anti-stale TUI Claude:
#   • restart periodico worker per igiene (sessione TUI può "scadere"
#     dopo ore: cache locale corrotta, token oauth scaduto, modal in
#     loop "Loading usage data…")
#   • cross-check con HTTP ogni N tick per detectare divergenze
#   • detect "Loading…" → return None → cascata su HTTP, e respawn
#     worker prima del prossimo tick
WORKER_RESTART_INTERVAL_MIN = 20     # restart worker ogni 20 min (igiene proattiva)
HTTP_CROSSCHECK_EVERY_N_TICKS = 5    # confronto TUI vs HTTP ogni 5 tick
TUI_HTTP_DIVERGENCE_THRESHOLD = 5    # se diff > 5 punti = stale TUI

# State module-level per il TUI parser (mantenuto tra chiamate)
_worker_last_restart_ts = None
_tui_tick_counter = 0


def _kill_worker():
    """Killa SENTINELLA-WORKER in modo non bloccante."""
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", WORKER_SESSION],
            capture_output=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, OSError):
        pass


def _try_claude_tui_parser():
    """Primario per Claude: capture-pane SENTINELLA-WORKER + parse.

    Mitigazioni applicate:
      1. Restart periodico worker ogni WORKER_RESTART_INTERVAL_MIN (60 min)
         per evitare che la sessione TUI vada in stato stale.
      2. Cross-check con HTTP ogni HTTP_CROSSCHECK_EVERY_N_TICKS (5)
         per detectare TUI che mostra dati cached.
      3. Detect "Loading usage data…" nel parser → return None →
         cade su HTTP, respawn worker prima del prossimo tick.

    Ritorna parsed dict {usage, reset_at, weekly_usage} o None se fail.
    """
    global _worker_last_restart_ts, _tui_tick_counter

    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "check_usage", "/app/shared/skills/check_usage.py"
        )
        if spec is None or spec.loader is None:
            return None
        cu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cu)
    except (OSError, ImportError):
        return None

    now = time.time()

    # ── 1. Restart periodico per igiene ──
    if _worker_last_restart_ts is None:
        # Primo boot: marca solo
        _worker_last_restart_ts = now
    elif (now - _worker_last_restart_ts) > WORKER_RESTART_INTERVAL_MIN * 60:
        print(f"[bridge V5] worker restart periodico (>{WORKER_RESTART_INTERVAL_MIN} min)")
        _kill_worker()
        _worker_last_restart_ts = now
        _tui_tick_counter = 0
        # Non blocco con sleep qui: il check sotto rispawnerà se serve
        # e per QUESTO tick fallisce → cade su HTTP

    # Worker deve essere attivo. Se non lo è, spawn + 18s wait.
    if not cu.tmux_has_session(WORKER_SESSION):
        try:
            subprocess.run(
                ["bash", START_AGENT_SH, "worker"],
                capture_output=True, timeout=10,
            )
            time.sleep(cu.WORKER_BOOT_WAIT_S)
        except (subprocess.TimeoutExpired, OSError):
            return None
        if not cu.tmux_has_session(WORKER_SESSION):
            return None

    # Query il worker
    buf = cu.query_claude_worker()
    parsed = cu.parse_claude_usage(buf)

    # ── 3. Detect "Loading…" failure: parsed=None + Loading nel buf ──
    if parsed is None:
        if buf and "Loading usage data" in buf:
            print("[bridge V5] TUI in 'Loading...' loop, kill+respawn worker")
            _kill_worker()
            _worker_last_restart_ts = now  # forza re-spawn dopo
        return None

    _tui_tick_counter += 1

    # Schema: check_usage {usage, reset_hhmm_utc, weekly}
    # → bridge {usage, reset_at, weekly_usage}
    tui_result = {
        "usage": parsed["usage"],
        "reset_at": parsed.get("reset_hhmm_utc"),
        "weekly_usage": parsed.get("weekly"),
    }

    # ── 2. Cross-check HTTP ogni N tick ──
    if _tui_tick_counter % HTTP_CROSSCHECK_EVERY_N_TICKS == 0:
        http = fetch_claude_api()
        if isinstance(http, dict) and isinstance(http.get("usage"), (int, float)):
            tui_u = tui_result["usage"]
            http_u = http["usage"]
            diff = abs(tui_u - http_u)
            if diff > TUI_HTTP_DIVERGENCE_THRESHOLD:
                print(f"[bridge V5] TUI/HTTP divergono: TUI={tui_u}% HTTP={http_u}% (Δ{diff}>5), uso HTTP + kill worker")
                _kill_worker()
                _worker_last_restart_ts = now
                return http  # USA HTTP per questo tick

    return tui_result


# ── Main loop V5 ────────────────────────────────────────────────────────

def _do_fetch(provider):
    """Cascata di fallback provider-aware. Ritorna (parsed, fail_reason).

    Per Claude:  TUI parser → HTTP /oauth/usage → fail (Sentinella prende il rilievo).
    Per Kimi:    HTTP /coding/v1/usages → fail.
    Per Codex:   JSONL rollout file → fail.

    Per kimi/codex la sorgente primaria è già stabile (no rate-limit),
    quindi non serve cascata interna. Per Claude invece la cascata è
    importante perché /oauth/usage rate-limita aggressivamente con tick
    rapido.
    """
    if provider in ("kimi", "moonshot"):
        p = fetch_kimi_api()
        return (p, None) if p else (None, "kimi_api_none")

    if provider in ("anthropic", "claude"):
        # 1. PRIMARIO: TUI parser (no rate-limit, fragile a cambi modal)
        p = _try_claude_tui_parser()
        if p:
            return p, None
        # 2. FALLBACK: HTTP /oauth/usage (rate-limit possibile)
        r = fetch_claude_api()
        if r == "RATE_LIMIT":
            return None, "claude_tui_fail+claude_429"
        if r is None:
            return None, "claude_tui_fail+claude_api_none"
        return r, None

    if provider == "openai":
        p = fetch_codex_rollout()
        return (p, None) if p else (None, "codex_rollout_none")

    return None, f"unsupported:{provider}"


def main():
    """Bridge V5: fetch usage + invia a Sentinella.

    Cascata di fetch:
      1. PRIMARIO: TUI parser (capture-pane SENTINELLA-WORKER persistente)
      2. FALLBACK: HTTP /oauth/usage (Claude) o equivalente
      3. Se entrambi falliscono → manda [BRIDGE FAILURE] alla Sentinella
         che farà fallback manuale con skill TUI worker.

    Il bridge scrive il sample (con compute_metrics) nel JSONL e manda
    [BRIDGE TICK] ricco con dati alla Sentinella, che decide se mandare
    ordini al Capitano.

    Anti-stale TUI: worker restart periodico (20 min), cross-check HTTP
    ogni 5 tick, detect "Loading…" → restart.
    """
    acquire_singleton_lock()
    override_min, _ = read_config()
    print(f"[bridge V6] pid={os.getpid()} sentinella={SENTINELLA_SESSION} capitano={CAPITANO_SESSION}")
    if override_min is not None:
        print(f"[bridge V6] tick interval: {override_min} min (override da config)")
    else:
        print(
            f"[bridge V6] tick interval: ADAPTIVE state machine "
            f"(default={DEFAULT_TICK_MIN}min, g-spot fast={GSPOT_FAST_TICK_MIN}min, "
            f"stable={GSPOT_STABLE_TICK_MIN}min, calm={GSPOT_CALM_TICK_MIN}min)"
        )
        print(
            f"[bridge V6] g-spot=[{GSPOT_LOWER}-{GSPOT_UPPER}%], "
            f"sentinella cooldown={SENTINELLA_COOLDOWN_MIN}min"
        )

    fail_streak = 0
    capitano_alerted = False   # alert al capitano già mandato per questo episodio?
    is_first_tick = True        # cold-start forzato al primo tick post-boot
    # State machine V6: tick_phase ∈ DEFAULT/GSPOT_FAST/GSPOT_STABLE/GSPOT_CALM,
    # gspot_consecutive = tick consecutivi nel g-spot, last_sent_ts = ts ultima
    # notifica critica alla Sentinella (None se reset).
    state = {
        "tick_phase": "DEFAULT",
        "gspot_consecutive": 0,
        "last_sent_ts": None,
    }

    while True:
        now_h = datetime.now().strftime("%H:%M:%S")
        override_min, provider = read_config()

        parsed, fail_reason = _do_fetch(provider)

        if parsed:
            # ── Path successo: scrivi sample, tick alla Sentinella ────
            parsed["provider"] = provider
            if is_first_tick:
                last = None
                history = []
                is_first_tick = False
            else:
                last = load_last_sample()
                if last and last.get("provider") != provider:
                    last = None
                    history = []
                else:
                    history = load_recent_samples(30)
            entry = _compute_metrics_via_skill(parsed, last, history)
            entry["source"] = "bridge"
            write_jsonl(entry)
            write_log(entry)

            usage = entry.get("usage")
            proj = entry.get("projection")
            status = entry.get("status")
            reset = entry.get("reset_at") or "?"

            # V6: aggiorna state machine del tick interval e decide se
            # svegliare la Sentinella. Il bridge scrive SEMPRE il sample
            # nel JSONL (monitoring puro), ma manda [BRIDGE TICK] alla
            # Sentinella solo quando proj è fuori dal g-spot e il cooldown
            # è scaduto. In g-spot la Sentinella resta in standby.
            in_gspot = _is_in_gspot(proj)
            _advance_tick_phase(state, in_gspot)
            now_ts = time.time()
            should_notify = _should_notify_sentinella(in_gspot, state, now_ts)

            print(
                f"[bridge V6] {now_h} OK usage={usage}% proj={proj} status={status} "
                f"phase={state['tick_phase']} gspot={in_gspot} notify={should_notify}"
            )

            if should_notify and session_exists(SENTINELLA_SESSION):
                jht_tmux_send(
                    SENTINELLA_SESSION,
                    f"[BRIDGE TICK] ts={now_h} usage={usage}% proj={proj}% status={status} reset={reset} src=bridge."
                )
                state["last_sent_ts"] = now_ts

            # Recovery se eravamo in failure streak
            if fail_streak >= FETCH_FAIL_THRESHOLD or capitano_alerted:
                if session_exists(CAPITANO_SESSION):
                    jht_tmux_send(
                        CAPITANO_SESSION,
                        "[BRIDGE INFO] sorgente usage tornata responsiva, monitoraggio normale."
                    )
                capitano_alerted = False
            fail_streak = 0

        else:
            # ── Path fallimento ────────────────────────────────────────
            fail_streak += 1
            print(f"[bridge V6] {now_h} FAIL #{fail_streak} reason={fail_reason}")

            # Notifica Sentinella al primo fail dell'episodio
            if fail_streak == 1 and session_exists(SENTINELLA_SESSION):
                jht_tmux_send(
                    SENTINELLA_SESSION,
                    f"[BRIDGE FAILURE] ts={now_h} fetch fallito (reason={fail_reason}). Esegui fallback come da prompt."
                )

            # Alert al Capitano al N° fail consecutivo
            if fail_streak == FETCH_FAIL_THRESHOLD and not capitano_alerted:
                if session_exists(CAPITANO_SESSION):
                    eff_min = _choose_tick_interval(state, override_min)
                    jht_tmux_send(
                        CAPITANO_SESSION,
                        f"[BRIDGE ALERT] sorgente usage degraded da {FETCH_FAIL_THRESHOLD} tick "
                        f"(~{FETCH_FAIL_THRESHOLD * eff_min:.0f} min, reason={fail_reason}). "
                        "La Sentinella sta coprendo con fallback. Opera prudente."
                    )
                capitano_alerted = True

        # Tick interval V6: state machine basata sul g-spot.
        next_tick_min = _choose_tick_interval(state, override_min)
        sleep_sec = max(MIN_TICK_SECONDS, next_tick_min * 60)

        # Pubblica lo stato corrente per la UI web (atomic write).
        # last_tick_at = inizio iterazione corrente; next_tick_at = quando
        # ci risveglieremo dallo sleep. Su path fallimento usiamo gli ultimi
        # valori conosciuti (parsed=None → status/proj/usage non aggiornati).
        last_tick_iso = datetime.now(timezone.utc).isoformat()
        next_tick_iso = (datetime.now(timezone.utc) + timedelta(seconds=sleep_sec)).isoformat()
        if parsed:
            _write_state_file(
                state, last_tick_iso, next_tick_iso, next_tick_min,
                last_status=status, last_projection=proj, last_usage=usage,
            )
        else:
            _write_state_file(state, last_tick_iso, next_tick_iso, next_tick_min)

        time.sleep(sleep_sec)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[bridge V6] interrotto.")
