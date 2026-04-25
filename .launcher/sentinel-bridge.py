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

TICK_INTERVAL_MIN = 5                  # fisso post-V5
FETCH_FAIL_THRESHOLD = 3               # alert capitano dopo N fail consecutivi


# ── Config + tmux helpers (libreria per le skill) ───────────────────────

def read_config():
    """Ritorna (tick_minutes, provider). Tick non più usato dal bridge,
    mantenuto nel return per compat con skill che importano questa funzione."""
    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            cfg = json.load(f)
        provider = cfg.get("active_provider") or "openai"
        return TICK_INTERVAL_MIN, provider
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return TICK_INTERVAL_MIN, "openai"


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

def load_last_sample():
    if not DATA_JSONL.exists():
        return None
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        return json.loads(raw[-1]) if raw else None
    except (OSError, json.JSONDecodeError, IndexError):
        return None


def load_recent_samples(n=30):
    if not DATA_JSONL.exists():
        return []
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        out = []
        for line in raw[-n:]:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out
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


# ── Main loop V5 ────────────────────────────────────────────────────────

def _do_fetch(provider):
    """Wrapper provider-aware. Ritorna (parsed, fail_reason)."""
    if provider in ("kimi", "moonshot"):
        p = fetch_kimi_api()
        return (p, None) if p else (None, "kimi_api_none")
    if provider in ("anthropic", "claude"):
        r = fetch_claude_api()
        if r == "RATE_LIMIT":
            return None, "claude_429"
        if r is None:
            return None, "claude_api_none"
        return r, None
    if provider == "openai":
        p = fetch_codex_rollout()
        return (p, None) if p else (None, "codex_rollout_none")
    return None, f"unsupported:{provider}"


def main():
    acquire_singleton_lock()
    print(f"[bridge V5] pid={os.getpid()} sentinella={SENTINELLA_SESSION} capitano={CAPITANO_SESSION}")
    print(f"[bridge V5] tick interval: {TICK_INTERVAL_MIN} min")

    fail_streak = 0
    capitano_alerted = False  # alert al capitano già mandato per questo episodio?

    while True:
        now_h = datetime.now().strftime("%H:%M:%S")
        _, provider = read_config()

        parsed, fail_reason = _do_fetch(provider)

        if parsed:
            # ── Path successo: scrivi sample, tick alla Sentinella ────
            parsed["provider"] = provider
            last = load_last_sample()
            if last and last.get("provider") != provider:
                # Provider switch: invalida history come boot pulito
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
            print(f"[bridge V5] {now_h} OK usage={usage}% proj={proj} status={status}")

            if session_exists(SENTINELLA_SESSION):
                jht_tmux_send(
                    SENTINELLA_SESSION,
                    f"[BRIDGE TICK] usage={usage}% proj={proj}% status={status} reset={reset} src=bridge."
                )

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
            print(f"[bridge V5] {now_h} FAIL #{fail_streak} reason={fail_reason}")

            # Notifica Sentinella al primo fail dell'episodio
            if fail_streak == 1 and session_exists(SENTINELLA_SESSION):
                jht_tmux_send(
                    SENTINELLA_SESSION,
                    f"[BRIDGE FAILURE] fetch fallito (reason={fail_reason}). Esegui fallback come da prompt."
                )

            # Alert al Capitano al N° fail consecutivo
            if fail_streak == FETCH_FAIL_THRESHOLD and not capitano_alerted:
                if session_exists(CAPITANO_SESSION):
                    jht_tmux_send(
                        CAPITANO_SESSION,
                        f"[BRIDGE ALERT] sorgente usage degraded da {FETCH_FAIL_THRESHOLD} tick "
                        f"(~{FETCH_FAIL_THRESHOLD * TICK_INTERVAL_MIN} min, reason={fail_reason}). "
                        "La Sentinella sta coprendo con fallback. Opera prudente."
                    )
                capitano_alerted = True

        time.sleep(TICK_INTERVAL_MIN * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[bridge V5] interrotto.")
