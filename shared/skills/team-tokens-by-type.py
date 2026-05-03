#!/usr/bin/env python3
"""team-tokens-by-type.py — serie temporale dei 4 TIPI di token consumati
dal team aggregato.

A differenza di token-by-agent-series.py (che divide per agente e somma il
weighted in un singolo numero), questo script mantiene **separati** i 4
tipi di token che il provider conta:

  - input_other       (input non cached, "fresh")
  - output            (output del modello)
  - input_cache_read  (input riletti da cache)
  - input_cache_creation (input scritti in cache la prima volta)

Lo usa la pagina /team per visualizzare la composizione del consumo
nel tempo, e per (futuro) calibrare empiricamente i pesi del rate limit
provider via least-squares.

Schema output:
{
  "ok": true,
  "now": "...",
  "since": "...",
  "bucket_sec": 60,
  "series": [
    {
      "ts": "...",
      "input_kt":          12.3,   # cumulativo team
      "output_kt":          5.1,
      "cache_read_kt":     50.0,
      "cache_creation_kt":  4.2,
    },
    ...
  ],
  "totals_kt": {
    "input": 12.3, "output": 5.1, "cache_read": 50.0, "cache_creation": 4.2,
  }
}
"""
import argparse
import json
import os
import sys
from collections import defaultdict
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


# Tipo evento: (ts, input_other, output, cache_read, cache_creation) — RAW counts.
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
                        msg = e.get("message") or {}
                        pl = msg.get("payload") or {}
                        tu = pl.get("token_usage")
                        if not isinstance(tu, dict):
                            continue
                        events.append((
                            float(ts),
                            float(tu.get("input_other", 0)),
                            float(tu.get("output", 0)),
                            float(tu.get("input_cache_read", 0)),
                            float(tu.get("input_cache_creation", 0)),
                        ))
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
                        if not isinstance(usage, dict):
                            continue
                        events.append((
                            ts,
                            float(usage.get("input_tokens", 0)),
                            float(usage.get("output_tokens", 0)),
                            float(usage.get("cache_read_input_tokens", 0)),
                            float(usage.get("cache_creation_input_tokens", 0)),
                        ))
            except OSError:
                continue


def build_series(events, since_ts: float, now_ts: float, bucket_sec: int):
    """Bucket fissi nel range [since_ts, now_ts] con cumulativo team per
    ogni tipo. Ritorna list[dict]."""
    if bucket_sec <= 0:
        bucket_sec = 60
    start = int(since_ts) - (int(since_ts) % bucket_sec)
    end = int(now_ts)
    n_buckets = max(1, (end - start) // bucket_sec + 1)

    events.sort()
    series = []
    cum_in = cum_out = cum_cr = cum_cc = 0.0
    idx = 0
    for b in range(n_buckets):
        bucket_end = start + (b + 1) * bucket_sec
        while idx < len(events) and events[idx][0] < bucket_end:
            _, in_, out_, cr_, cc_ = events[idx]
            cum_in += in_
            cum_out += out_
            cum_cr += cr_
            cum_cc += cc_
            idx += 1
        series.append({
            "ts": datetime.fromtimestamp(start + b * bucket_sec, tz=timezone.utc).isoformat(),
            "input_kt": round(cum_in / 1000.0, 2),
            "output_kt": round(cum_out / 1000.0, 2),
            "cache_read_kt": round(cum_cr / 1000.0, 2),
            "cache_creation_kt": round(cum_cc / 1000.0, 2),
        })
    return series, {
        "input": round(cum_in / 1000.0, 2),
        "output": round(cum_out / 1000.0, 2),
        "cache_read": round(cum_cr / 1000.0, 2),
        "cache_creation": round(cum_cc / 1000.0, 2),
    }


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

    series, totals = build_series(events, since_ts, now_ts, args.bucket_sec)
    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "bucket_sec": args.bucket_sec,
        "totals_kt": totals,
        "events_count": len(events),
        "series": series,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
