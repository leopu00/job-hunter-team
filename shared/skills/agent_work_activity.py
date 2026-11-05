#!/usr/bin/env python3
"""agent_work_activity — what each agent WORKED on over a window, as one closed answer for the app's Agents page. Read only.

The question the page asks is «who worked, when and how much», never «whose session is open»: a session is open all day,
so a bar drawn from it is always full. Here an agent worked in a stretch of time when

  * its provider wrote tokens in that stretch (Codex rollouts, Claude and Kimi transcripts: token-by-agent-series.py), or
  * it is `lavora` right now (agent_state.py: an open turn with a recent event), which marks the LAST stretch only.

The window is cut in buckets that are aligned to the clock (a multiple of the bucket's length), so the same stretch is
the same bucket whatever the moment of the question, and every view of the page (lanes, gantt, donut, totals) reads this
one answer. The tokens are the weighted kT of token-by-agent-series.py, the same unit as the Budget page's role shares.

The answer is numbers, booleans and CODES, never a sentence: the page writes every sentence in the person's language. A
number the team does not have is `None`, never 0.

Uso (da agent_control.py):  activity <5m|15m|1h|5h|24h|7d>
"""
from __future__ import annotations

import importlib.util
import math
import re
import sys
from pathlib import Path

# Run from stdin (the read-only channel) the file has no __file__: the caller then gives the series' path.
HERE = Path(globals().get("__file__") or "/app/shared/skills/agent_work_activity.py").resolve().parent

# window → (length in seconds, bucket in seconds). The bucket divides the window and is a multiple of 5 s, so the
# aligned edges of a bucket are the same for every window that shares a divisor.
WINDOWS: dict[str, tuple[int, int]] = {
    "5m": (300, 15),          # 20 buckets
    "15m": (900, 60),         # 15
    "1h": (3600, 120),        # 30
    "5h": (18000, 600),       # 30
    "24h": (86400, 1800),     # 48
    "7d": (604800, 10800),    # 56
}
MAX_AGENTS = 200
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
# States of agent_state.py that mean «at work now» (the same word the agents' list shows).
WORKING_STATES = frozenset({"lavora"})


def load_series(path=None):
    """token-by-agent-series.py (its name has hyphens, so it is loaded by path)."""
    spec = importlib.util.spec_from_file_location("token_by_agent_series_work", path or HERE / "token-by-agent-series.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bucket_edges(now: float, window: str) -> tuple[int, int, int, int]:
    """(since, end, bucket_s, count): `end` is `now` rounded UP to the bucket, so the last bucket is the one `now` is in."""
    span, bucket = WINDOWS[window]
    end = int(math.ceil(now / bucket)) * bucket
    count = span // bucket
    return end - span, end, bucket, count


def build_activity(by_agent: dict, states: dict | None, now: float, window: str, live: set | None = None) -> dict:
    """The closed answer for `window`.

    by_agent: {agent: [(ts, weighted_tokens), ...]} (token-by-agent-series.collect_events).
    states:   {agent_lowercase: state word} or None when the team could not be asked: then nothing is said about «now».
    live:     the agents that exist now (lowercase), so one that did not write a token still has its row, empty.
    """
    since, end, bucket, count = bucket_edges(now, window)
    rows = []
    unattributed = 0.0
    names = {a for a in by_agent if isinstance(a, str) and NAME.match(a)} | {a for a in (live or set()) if NAME.match(a)}
    for agent, events in by_agent.items():
        if not (isinstance(agent, str) and NAME.match(agent)):
            unattributed += sum(w for ts, w in events if since <= ts < end)
    for name in sorted(names)[:MAX_AGENTS]:
        kt = [0.0] * count
        for ts, w in by_agent.get(name, ()):
            if since <= ts < end:
                kt[min(count - 1, int((ts - since) // bucket))] += w
        kt = [round(v / 1000.0, 2) for v in kt]
        state = states.get(name) if states is not None else None
        working_now = state in WORKING_STATES
        work = [1 if v > 0 else 0 for v in kt]
        if working_now:
            work[-1] = 1
        total = round(sum(kt), 2)
        hours = (end - since) / 3600.0
        rows.append({
            "name": name,
            "state": state if isinstance(state, str) and len(state) <= 40 else None,
            "kt": kt,
            "work": work,
            "total_kt": total,
            "avg_kt_h": round(total / hours, 2),
            "worked_buckets": sum(work),
        })
    rows.sort(key=lambda r: (-r["total_kt"], r["name"]))
    return {"window": window, "now": int(now), "since": since, "end": end, "bucket_s": bucket, "buckets": count,
            "agents": rows, "unattributed_kt": round(unattributed / 1000.0, 2), "states": states is not None}


def read_activity(window, now: float, states: dict | None, live: set | None = None, series=None, series_path=None) -> dict:
    """`{"ok": True, "data": ...}` or `{"ok": False, "error": ...}` for the agents' read channel."""
    if not isinstance(window, str) or window not in WINDOWS:
        return {"ok": False, "error": "agent_control_invalid"}
    series = series or load_series(series_path)
    since, _end, _bucket, _count = bucket_edges(now, window)
    try:
        by_agent = series.collect_events(float(since))
    except Exception:  # noqa: BLE001 - a transcript that cannot be read is «unavailable», never a made-up zero
        return {"ok": False, "error": "agents_unavailable"}
    return {"ok": True, "data": build_activity(by_agent, states, now, window, live)}


if __name__ == "__main__":  # a manual look: python3 agent_work_activity.py 1h
    import json
    import time
    print(json.dumps(read_activity(sys.argv[1] if len(sys.argv) > 1 else "1h", time.time(), None)))
