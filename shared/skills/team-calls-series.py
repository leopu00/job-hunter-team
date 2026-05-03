#!/usr/bin/env python3
"""team-calls-series.py — serie temporale del NUMERO di chiamate API team.

Il rate limit Kimi Code (CLI) è basato su CHIAMATE API per finestra 5h,
NON su token (vedi platform.kimi.ai/docs/introduction +
www.kimi.com/code/docs/en/). Questo script conta le chiamate aggregate
team con la stessa estrazione eventi degli altri script (Kimi wire.jsonl
+ Claude project jsonl), ma a differenza di token-by-agent-series.py
non somma weighted tokens — somma 1 per ogni evento API.

Schema output:
{
  "ok": true,
  "now": "...",
  "since": "...",
  "bucket_sec": 60,
  "series": [
    { "ts": "...", "calls": 12 },   # cumulativo team
    ...
  ],
  "totals_calls": 1234
}
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI_DIR = JHT_HOME / ".kimi" / "sessions"
CLAUDE_DIR = JHT_HOME / ".claude" / "projects"
CLAUDE_AGENT_PREFIX = "-jht-home-agents-"


def _parse_iso_to_ts(s) -> float:
    if not isinstance(s, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return 0.0


def _collect_kimi(events: list, since_ts: float) -> None:
    if not KIMI_DIR.exists():
        return
    for hd in KIMI_DIR.iterdir():
        if not hd.is_dir():
            continue
        for sd in hd.iterdir():
            if not sd.is_dir():
                continue
            wire = sd / "wire.jsonl"
            if not wire.exists():
                continue
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
                        if not isinstance(ts, (int, float)) or ts < since_ts:
                            continue
                        # Conta come "chiamata" SOLO eventi con token_usage
                        # (= risposta API completa, non frammenti SSE).
                        msg = e.get("message") or {}
                        pl = msg.get("payload") or {}
                        if isinstance(pl.get("token_usage"), dict):
                            events.append(float(ts))
            except OSError:
                continue


def _collect_claude(events: list, since_ts: float) -> None:
    if not CLAUDE_DIR.exists():
        return
    for proj_dir in CLAUDE_DIR.iterdir():
        if not proj_dir.is_dir():
            continue
        if not proj_dir.name.startswith(CLAUDE_AGENT_PREFIX):
            continue
        for jsonl_file in proj_dir.glob("*.jsonl"):
            try:
                with jsonl_file.open() as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        ts_raw = e.get("timestamp") or e.get("ts")
                        ts = _parse_iso_to_ts(ts_raw) if isinstance(ts_raw, str) else 0.0
                        if ts <= 0 or ts < since_ts:
                            continue
                        msg = e.get("message") or {}
                        usage = msg.get("usage") if isinstance(msg, dict) else None
                        if isinstance(usage, dict):
                            events.append(ts)
            except OSError:
                continue


def build_series(events, since_ts: float, now_ts: float, bucket_sec: int):
    if bucket_sec <= 0:
        bucket_sec = 60
    start = int(since_ts) - (int(since_ts) % bucket_sec)
    end = int(now_ts)
    n_buckets = max(1, (end - start) // bucket_sec + 1)
    events.sort()
    series = []
    cum = 0
    idx = 0
    for b in range(n_buckets):
        bucket_end = start + (b + 1) * bucket_sec
        while idx < len(events) and events[idx] < bucket_end:
            cum += 1
            idx += 1
        series.append({
            "ts": datetime.fromtimestamp(start + b * bucket_sec, tz=timezone.utc).isoformat(),
            "calls": cum,
        })
    return series, cum


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-min", type=float, default=180.0)
    ap.add_argument("--bucket-sec", type=int, default=60)
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=args.since_min)
    now_ts = now.timestamp()
    since_ts = since.timestamp()

    events: list = []
    _collect_kimi(events, since_ts)
    _collect_claude(events, since_ts)

    series, total = build_series(events, since_ts, now_ts, args.bucket_sec)
    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "bucket_sec": args.bucket_sec,
        "totals_calls": total,
        "series": series,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
