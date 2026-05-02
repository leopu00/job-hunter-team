#!/usr/bin/env python3
"""token-meter.py — PoC: misura token consumati dai log locali e confronta col bridge.

Letture (sola lettura, NESSUN side-effect sul team / bridge):
  • $JHT_HOME/.kimi/sessions/*/*/wire.jsonl  → token_usage per messaggio
  • $JHT_HOME/.codex/sessions/.../rollout-*.jsonl  → total_token_usage per call
  • $JHT_HOME/.claude/projects/.../*.jsonl  → message.usage per response
  • $JHT_HOME/logs/sentinel-bridge-state.json  → last_usage% del bridge

Output:
  • stdout: 1 riga ogni INTERVAL_S secondi
  • $JHT_HOME/logs/token-meter.csv  → CSV append per post-analisi
  • $JHT_HOME/logs/token-meter.log  → mirror stdout (via tee, lato launcher)

Logica:
  1. window_start = now - WINDOW_HOURS (rate budget Kimi/Claude ~5h)
  2. somma token_usage di tutti gli eventi con ts >= window_start
  3. weighted = input_other + output + cache_read*0.1 + cache_creation*1.25
  4. legge bridge.last_usage% (autoritativo del provider)
  5. ratio = weighted / pct  → tokens equivalenti a 1% del rate budget
  6. proietta a granularità sub-tick

NOTA: i pesi cache (1/10, 5/4) sono ipotesi di partenza. Se il ratio oscilla
fra una calibrazione e l'altra (con team a velocità ~costante), i pesi vanno
fittati con una regressione su più punti.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI_SESSIONS = JHT_HOME / ".kimi" / "sessions"
CODEX_SESSIONS = JHT_HOME / ".codex" / "sessions"
CLAUDE_PROJECTS = JHT_HOME / ".claude" / "projects"
BRIDGE_STATE = JHT_HOME / "logs" / "sentinel-bridge-state.json"
JSONL_DATA = JHT_HOME / "logs" / "sentinel-data.jsonl"
CSV_OUT = JHT_HOME / "logs" / "token-meter.csv"
CONFIG_PATH = JHT_HOME / "jht.config.json"

WINDOW_HOURS = 5.0
INTERVAL_S = 30


def read_active_provider():
    """Leggi provider attivo dal config JHT (kimi / openai / claude)."""
    try:
        with CONFIG_PATH.open() as f:
            return (json.load(f).get("active_provider") or "openai").lower()
    except (OSError, json.JSONDecodeError):
        return "openai"


def read_bridge_state():
    try:
        with BRIDGE_STATE.open() as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


# ── Provider readers ─────────────────────────────────────────────────────


def read_kimi_tokens(window_start_ts):
    """Somma token_usage da tutti i wire.jsonl Kimi nella finestra.

    Ritorna dict {input_other, output, input_cache_read, input_cache_creation,
    events, sessions, by_session}.
    """
    out = {
        "input_other": 0, "output": 0,
        "input_cache_read": 0, "input_cache_creation": 0,
        "events": 0, "sessions": 0,
    }
    by_session = {}
    if not KIMI_SESSIONS.exists():
        return out, by_session

    for wire in KIMI_SESSIONS.rglob("wire.jsonl"):
        sess = wire.parent.name
        try:
            with wire.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts = e.get("timestamp")
                    if not isinstance(ts, (int, float)):
                        continue
                    if ts < window_start_ts:
                        continue
                    msg = e.get("message") or {}
                    pl = msg.get("payload") or {}
                    tu = pl.get("token_usage")
                    if not isinstance(tu, dict):
                        continue
                    for k in ("input_other", "output", "input_cache_read", "input_cache_creation"):
                        v = tu.get(k, 0)
                        if isinstance(v, (int, float)):
                            out[k] += v
                    out["events"] += 1
                    by_session.setdefault(sess, 0)
                    by_session[sess] += tu.get("input_other", 0) + tu.get("output", 0)
        except OSError:
            continue
    out["sessions"] = len(by_session)
    return out, by_session


def read_claude_tokens(window_start_ts):
    """Somma usage da tutti i project jsonl di Claude Code nella finestra."""
    out = {
        "input_tokens": 0, "output_tokens": 0,
        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
        "events": 0, "sessions": 0,
    }
    by_session = {}
    if not CLAUDE_PROJECTS.exists():
        return out, by_session

    window_dt = datetime.fromtimestamp(window_start_ts, tz=timezone.utc)
    for proj_jsonl in CLAUDE_PROJECTS.rglob("*.jsonl"):
        sess = proj_jsonl.stem
        try:
            with proj_jsonl.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts_str = e.get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        continue
                    if ts < window_dt:
                        continue
                    usage = (e.get("message") or {}).get("usage")
                    if not isinstance(usage, dict):
                        continue
                    for k in out:
                        v = usage.get(k, 0)
                        if isinstance(v, (int, float)):
                            out[k] += v
                    out["events"] += 1
                    by_session.setdefault(sess, 0)
                    by_session[sess] += usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        except OSError:
            continue
    out["sessions"] = len(by_session)
    return out, by_session


def read_codex_tokens(window_start_ts):
    """Somma last_token_usage da rollout-*.jsonl di Codex nella finestra."""
    out = {
        "input_tokens": 0, "output_tokens": 0,
        "cached_input_tokens": 0, "reasoning_output_tokens": 0,
        "total_tokens": 0, "events": 0, "sessions": 0,
    }
    by_session = {}
    if not CODEX_SESSIONS.exists():
        return out, by_session

    window_dt = datetime.fromtimestamp(window_start_ts, tz=timezone.utc)
    for rollout in CODEX_SESSIONS.rglob("rollout-*.jsonl"):
        sess = rollout.stem
        try:
            with rollout.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts_str = e.get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        continue
                    if ts < window_dt:
                        continue
                    pl = e.get("payload") or {}
                    if pl.get("type") != "token_count":
                        continue
                    tu = (pl.get("info") or {}).get("last_token_usage") or {}
                    for k in ("input_tokens", "output_tokens", "cached_input_tokens",
                              "reasoning_output_tokens", "total_tokens"):
                        v = tu.get(k, 0)
                        if isinstance(v, (int, float)):
                            out[k] += v
                    out["events"] += 1
                    by_session.setdefault(sess, 0)
                    by_session[sess] += tu.get("total_tokens", 0)
        except OSError:
            continue
    out["sessions"] = len(by_session)
    return out, by_session


# ── Billing weighting ────────────────────────────────────────────────────

CACHE_READ_WEIGHT = 0.1     # cache hit costa ~10% del normale
CACHE_CREATION_WEIGHT = 1.25  # cache creation costa ~25% in più


def kimi_weighted(t):
    return (
        t["input_other"] + t["output"]
        + t["input_cache_read"] * CACHE_READ_WEIGHT
        + t["input_cache_creation"] * CACHE_CREATION_WEIGHT
    )


def claude_weighted(t):
    return (
        t["input_tokens"] + t["output_tokens"]
        + t["cache_read_input_tokens"] * CACHE_READ_WEIGHT
        + t["cache_creation_input_tokens"] * CACHE_CREATION_WEIGHT
    )


def codex_weighted(t):
    # OpenAI: cached_input ≈ 1/2 di input
    return (
        t["input_tokens"] + t["output_tokens"] + t["reasoning_output_tokens"]
        + t["cached_input_tokens"] * 0.5
    )


# ── Main loop ────────────────────────────────────────────────────────────


def main():
    provider = read_active_provider()
    print(f"[token-meter] start provider={provider} interval={INTERVAL_S}s window={WINDOW_HOURS}h",
          flush=True)
    print(f"[token-meter] CSV={CSV_OUT}", flush=True)

    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_OUT.exists():
        with CSV_OUT.open("w") as f:
            f.write("ts,provider,bridge_pct,bridge_proj,bridge_status,events,"
                    "in_raw,out_raw,cache_read_raw,cache_creation_raw,"
                    "weighted,ratio_tokens_per_pct,sessions\n")

    while True:
        now = datetime.now(timezone.utc)
        window_start_ts = (now - timedelta(hours=WINDOW_HOURS)).timestamp()

        if provider == "kimi":
            totals, by_sess = read_kimi_tokens(window_start_ts)
            weighted = kimi_weighted(totals) if totals["events"] else 0
            in_raw, out_raw = totals["input_other"], totals["output"]
            cache_r, cache_c = totals["input_cache_read"], totals["input_cache_creation"]
        elif provider == "claude":
            totals, by_sess = read_claude_tokens(window_start_ts)
            weighted = claude_weighted(totals) if totals["events"] else 0
            in_raw, out_raw = totals["input_tokens"], totals["output_tokens"]
            cache_r, cache_c = totals["cache_read_input_tokens"], totals["cache_creation_input_tokens"]
        else:  # openai/codex
            totals, by_sess = read_codex_tokens(window_start_ts)
            weighted = codex_weighted(totals) if totals["events"] else 0
            in_raw, out_raw = totals["input_tokens"], totals["output_tokens"]
            cache_r, cache_c = totals["cached_input_tokens"], 0

        state = read_bridge_state() or {}
        bridge_pct = state.get("last_usage")
        bridge_proj = state.get("last_projection")
        bridge_status = state.get("last_status") or ""
        bridge_tick = state.get("last_tick_at", "")[:19]

        ratio = (weighted / bridge_pct) if (bridge_pct and bridge_pct > 0 and weighted > 0) else None

        ratio_str = f"{ratio/1000:.2f}kT/1%" if ratio else "n/a"
        line = (
            f"[{now.strftime('%H:%M:%S')}] {provider:6} "
            f"bridge={str(bridge_pct):>3}% proj={str(bridge_proj):>6} ({bridge_status:>12}) "
            f"@ {bridge_tick} | "
            f"events={totals['events']:>3} sess={totals['sessions']} "
            f"in={in_raw:>7,} out={out_raw:>5,} "
            f"cache_r={cache_r:>9,} cache_w={cache_c:>5,} "
            f"weighted={int(weighted):>8,} | ratio={ratio_str}"
        )
        print(line, flush=True)

        with CSV_OUT.open("a") as f:
            f.write(
                f"{now.isoformat()},{provider},{bridge_pct or ''},{bridge_proj or ''},"
                f"{bridge_status},{totals['events']},{in_raw},{out_raw},{cache_r},{cache_c},"
                f"{int(weighted)},{ratio or ''},{totals['sessions']}\n"
            )

        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[token-meter] stop")
        sys.exit(0)
