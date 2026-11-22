#!/usr/bin/env python3
"""session_cap.py — how many sessions a start may bring up: one number for every path that starts a worker.

The queue, the restore of the roster and the start of a worker each had a cap of their own (the capacity of the machine, on the
workers) and none of them counted the sessions in all: a restart could pass the eleven sessions of a team (six fixed, five
workers). The cap is the lowest of:

  * the roster's rule (plan_registry.burst_roster: the workers the plan asks, already cut by the machine when it carries less);
  * the capacity of the machine (plan_registry._host_agent_cap; none = not measurable, no cap from there);
  * MAX_SESSIONS in all (every live session counts, the fixed ones too).

A reading that cannot be taken is a brake, never a cap that is not there. An agent the Capitano retired is never brought back by
a start of the system (`is_retired`); one stopped for the hours is not a retired one.

  session_cap.py room            how many workers may be started now (JSON)
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
MAX_SESSIONS = 11
WORKER = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)(-\d+)?$")
_MODULES: dict = {}


def _load(name: str):
    if name in _MODULES:
        return _MODULES[name]
    mod = None
    try:
        if str(SKILLS) not in sys.path:
            sys.path.insert(0, str(SKILLS))
        spec = importlib.util.spec_from_file_location(name, SKILLS / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:  # noqa: BLE001 — a module that does not load is a reading that is not there
        mod = None
    _MODULES[name] = mod
    return mod


def roster_workers():
    """The workers the roster's rule allows (already cut by the machine), or None when the plan is not declared. Raises when unreadable."""
    registry = _load("plan_registry")
    if registry is None:
        raise RuntimeError("plan_registry does not load")
    plan = registry.burst_roster(assume_default=True)
    if not plan.get("ok"):
        return None
    return int(plan["total_workers"])


def host_workers():
    """The workers the machine carries, None when not measurable. Raises when unreadable."""
    registry = _load("plan_registry")
    if registry is None:
        raise RuntimeError("plan_registry does not load")
    cap = registry._host_agent_cap()  # noqa: SLF001 — the one source of the RAM cap
    return None if cap is None else int(cap)


def is_retired(session: str) -> bool:
    """True when the roster says the Capitano took this agent away on purpose."""
    roster = _load("team_roster")
    if roster is None:
        return False
    try:
        entry = roster.load()["agents"].get(str(session).strip().upper())
    except Exception:  # noqa: BLE001
        return False
    return bool(entry) and entry.get("status") == "retired"


def worker_cap(fixed: int = 6):
    """The workers that may be alive: min(roster, machine, MAX_SESSIONS - fixed). Raises when a reading breaks; at least one is known."""
    values = [v for v in (roster_workers(), host_workers()) if v is not None]
    values.append(max(0, MAX_SESSIONS - fixed))
    return max(0, min(values))


def standby_holds() -> bool:
    """True while a standby or a pause (the quota of the subscription spent, the person's pause) holds the team: no start, whoever asks."""
    mod = _load("standby")
    try:
        return bool(mod is not None and mod.is_active())
    except Exception:  # noqa: BLE001 — fail-closed in the other direction, as standby.is_active: an unreadable flag does not hold
        return False


def room(live_sessions) -> int:
    """How many more workers may be started: 0 when a cap is reached or cannot be read, or while the standby holds the team."""
    if standby_holds():
        return 0
    try:
        live = [str(s).strip().upper() for s in live_sessions]
        workers = [s for s in live if WORKER.match(s)]
        fixed = max(0, len(live) - len(workers))
        return max(0, min(worker_cap(min(fixed, MAX_SESSIONS)) - len(workers), MAX_SESSIONS - len(live)))
    except Exception:  # noqa: BLE001 — a cap that cannot be read is a brake
        return 0


def check(live_sessions):
    """None when one more worker may start; else the reason: team-standby, capacity, session-cap, capacity-unreadable."""
    if standby_holds():
        return "team-standby"
    try:
        live = [str(s).strip().upper() for s in live_sessions]
        workers = [s for s in live if WORKER.match(s)]
        if len(live) >= MAX_SESSIONS:
            return "session-cap"
        cap = worker_cap()
        if len(workers) >= cap:
            return "capacity"
        return None
    except Exception:  # noqa: BLE001
        return "capacity-unreadable"


def main(argv=None) -> int:
    from subprocess import run
    out = run(["tmux", "list-sessions", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout
    live = [s for s in out.split() if s]
    print(json.dumps({"room": room(live), "why": check(live), "sessions": len(live)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
