#!/usr/bin/env python3
"""throttle-series.py — serie temporale aggregata di pause `throttle` per la UI web.

Legge `$JHT_HOME/logs/throttle-events.jsonl` (popolato dalla skill
`throttle.py`), aggrega `applied_sec` per agente in bucket temporali
e stampa JSON su stdout.

Schema output (mirroring di token-by-agent-series.py):
{
  "ok": true,
  "now": "...",
  "since": "...",
  "bucket_sec": 60,
  "agents": ["scout-1", ...],
  "totals_sec": {"scout-1": 320, ...},
  "events": {"scout-1": 4, ...},
  "series": [
    {"ts": "2026-05-02T...", "scout-1": 0, ...},   ← cumulative seconds
    ...
  ]
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
EVENTS_FILE = JHT_HOME / "logs" / "throttle-events.jsonl"


def collect_events(since_ts: float):
    """Legge gli eventi di pausa COMPLETATI in [since_ts, now].

    Ritorna dict[agent] -> list[(ts, sleep_sec)] dove `sleep_sec` è il
    tempo di sleep effettivo (`actual_sleep_sec`) per gli eventi `end`.

    Filtri intenzionali:
      - eventi `start` IGNORATI: rappresentano solo l'intent. Se l'agente
        ha eseguito il comando in background e poi ha killato il bash,
        non avremo mai un `end` corrispondente — perfetto, non vogliamo
        contarlo come pausa rispettata.
      - eventi legacy senza campo `event` (precedenti all'introduzione di
        start/end) trattati come completati con `applied_sec`, per non
        cancellare la storia pre-fix.
    """
    by_agent = defaultdict(list)
    if not EVENTS_FILE.exists():
        return by_agent
    try:
        with EVENTS_FILE.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = e.get("ts_unix")
                if not isinstance(ts, (int, float)) or ts < since_ts:
                    continue
                event_type = e.get("event")
                if event_type == "start":
                    continue
                # event == "end" (nuovo) o assente (legacy): conta come completato.
                if event_type == "end":
                    sleep_sec = e.get("actual_sleep_sec")
                    if not isinstance(sleep_sec, (int, float)):
                        sleep_sec = e.get("applied_sec")
                else:
                    sleep_sec = e.get("applied_sec")
                agent = e.get("agent") or "?unknown"
                if not isinstance(sleep_sec, (int, float)) or sleep_sec <= 0:
                    continue
                by_agent[agent].append((float(ts), float(sleep_sec)))
    except OSError:
        return by_agent
    for a in by_agent:
        by_agent[a].sort()
    return by_agent


def build_series(by_agent, since_ts: float, now_ts: float, bucket_sec: int):
    """Cumulativa per agente a bucket fissi nel range [since_ts, now_ts]."""
    if bucket_sec <= 0:
        bucket_sec = 60
    start = int(since_ts) - (int(since_ts) % bucket_sec)
    end = int(now_ts)
    n_buckets = max(1, (end - start) // bucket_sec + 1)

    totals = {a: sum(s for _, s in evs) for a, evs in by_agent.items()}
    agents = sorted(totals.keys(), key=lambda a: -totals[a])

    series = []
    cumul = {a: 0.0 for a in agents}
    idx = {a: 0 for a in agents}

    for b in range(n_buckets):
        bucket_end = start + (b + 1) * bucket_sec
        for a in agents:
            evs = by_agent[a]
            i = idx[a]
            while i < len(evs) and evs[i][0] < bucket_end:
                cumul[a] += evs[i][1]
                i += 1
            idx[a] = i
        ts_iso = datetime.fromtimestamp(start + b * bucket_sec, tz=timezone.utc).isoformat()
        row = {"ts": ts_iso}
        for a in agents:
            row[a] = round(cumul[a], 1)
        series.append(row)

    return agents, series


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-min", type=float, default=180.0)
    ap.add_argument("--bucket-sec", type=int, default=60)
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=args.since_min)
    now_ts = now.timestamp()
    since_ts = since.timestamp()

    by_agent = collect_events(since_ts)
    agents, series = build_series(by_agent, since_ts, now_ts, args.bucket_sec)

    totals_sec = {a: round(sum(s for _, s in by_agent[a]), 1) for a in agents}
    events = {a: len(by_agent[a]) for a in agents}

    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "bucket_sec": args.bucket_sec,
        "agents": agents,
        "totals_sec": totals_sec,
        "events": events,
        "series": series,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
