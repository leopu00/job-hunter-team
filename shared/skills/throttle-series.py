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


def collect_events(since_ts: float, now_ts: float | None = None):
    """Legge gli eventi di pausa in [since_ts, now].

    Ritorna due strutture:
      • by_agent: dict[agent] -> list[(ts_end, sleep_sec)] — usata per
        la serie cumulativa. Solo end completati (matchati con start) o
        record legacy contano nel cumulativo: se un throttle non
        completa, non vogliamo gonfiare il totale di tempo "in pausa".
      • intervals: list[{agent, ts_start, ts_end, sec, interrupted}].
        Include anche start ORFANI (senza end), renderizzati con
        ts_end = min(now, ts_start + applied_sec) e interrupted=true.
        Così SIGKILL e altri kill non catchabili dalla skill restano
        comunque visibili nel chart eventi.

    Filtri intenzionali:
      - end matchato a start via `id`: intervallo "live" (interrupted da
        flag dell'evento end stesso, scritto da throttle.py).
      - start senza end + scaduto secondo applied_sec: intervallo
        "orfano" → interrupted=true sintetico, durata cap = ora.
      - start senza end + ancora "in volo" (would_end > now): saltato,
        non lo mostriamo ancora (apparirà al prossimo poll del frontend).
      - eventi legacy senza campo `event` (pre-fix start/end): trattati
        come finestra ts → ts+applied_sec, interrupted=false.
    """
    if now_ts is None:
        now_ts = float("inf")
    by_agent = defaultdict(list)
    intervals: list[dict] = []
    starts: dict[str, dict] = {}
    if not EVENTS_FILE.exists():
        return by_agent, intervals
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
                if not isinstance(ts, (int, float)):
                    continue
                agent = e.get("agent") or "?unknown"
                event_type = e.get("event")
                if event_type == "start":
                    eid = e.get("id")
                    if isinstance(eid, str):
                        starts[eid] = {
                            "agent": agent,
                            "ts_start": float(ts),
                            "applied_sec": float(e.get("applied_sec") or 0),
                        }
                    continue
                if ts < since_ts:
                    # end o legacy fuori finestra: skippiamo, però uno
                    # `start` precedente alla finestra che si chiude
                    # qui è ok (gestito sopra: lo start è già in starts).
                    continue
                if event_type == "end":
                    sleep_sec = e.get("actual_sleep_sec")
                    if not isinstance(sleep_sec, (int, float)):
                        sleep_sec = e.get("applied_sec")
                    if not isinstance(sleep_sec, (int, float)) or sleep_sec <= 0:
                        continue
                    by_agent[agent].append((float(ts), float(sleep_sec)))
                    eid = e.get("id")
                    s = starts.pop(eid, None) if isinstance(eid, str) else None
                    ts_start = s["ts_start"] if s else float(ts) - float(sleep_sec)
                    intervals.append({
                        "agent": agent,
                        "ts_start": ts_start,
                        "ts_end": float(ts),
                        "sec": float(sleep_sec),
                        "interrupted": bool(e.get("interrupted", False)),
                    })
                else:
                    # Legacy: niente split start/end. Finestra ts → ts+applied.
                    sleep_sec = e.get("applied_sec")
                    if not isinstance(sleep_sec, (int, float)) or sleep_sec <= 0:
                        continue
                    by_agent[agent].append((float(ts), float(sleep_sec)))
                    intervals.append({
                        "agent": agent,
                        "ts_start": float(ts),
                        "ts_end": float(ts) + float(sleep_sec),
                        "sec": float(sleep_sec),
                        "interrupted": False,
                    })
    except OSError:
        return by_agent, intervals
    # Orfani: start mai chiusi. Se la fine prevista è già passata, sono
    # certamente terminati senza end (SIGKILL o crash). Li mostriamo
    # come interrupted con ts_end = ts_start + applied_sec ma cap a now,
    # così non sforano nel futuro nel chart.
    now_eff = now_ts if now_ts != float("inf") else (
        max((iv["ts_end"] for iv in intervals), default=0.0)
    )
    for s in starts.values():
        applied = s["applied_sec"]
        if applied <= 0:
            continue
        ts_start = s["ts_start"]
        if ts_start < since_ts and (ts_start + applied) < since_ts:
            # orfano interamente fuori finestra
            continue
        ts_end_natural = ts_start + applied
        ts_end_capped = min(ts_end_natural, now_eff)
        if ts_end_capped <= ts_start:
            continue  # in volo, niente ancora da disegnare
        intervals.append({
            "agent": s["agent"],
            "ts_start": ts_start,
            "ts_end": ts_end_capped,
            "sec": ts_end_capped - ts_start,
            "interrupted": True,
            "orphan": True,
        })
    for a in by_agent:
        by_agent[a].sort()
    intervals.sort(key=lambda r: r["ts_start"])
    return by_agent, intervals


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

    by_agent, intervals = collect_events(since_ts, now_ts)
    agents, series = build_series(by_agent, since_ts, now_ts, args.bucket_sec)

    totals_sec = {a: round(sum(s for _, s in by_agent[a]), 1) for a in agents}
    events = {a: len(by_agent[a]) for a in agents}

    intervals_out = [
        {
            "agent": iv["agent"],
            "ts_start": datetime.fromtimestamp(iv["ts_start"], tz=timezone.utc).isoformat(),
            "ts_end": datetime.fromtimestamp(iv["ts_end"], tz=timezone.utc).isoformat(),
            "sec": round(iv["sec"], 1),
            "interrupted": bool(iv.get("interrupted", False)),
            "orphan": bool(iv.get("orphan", False)),
        }
        for iv in intervals
    ]

    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "bucket_sec": args.bucket_sec,
        "agents": agents,
        "totals_sec": totals_sec,
        "events": events,
        "series": series,
        "intervals": intervals_out,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
