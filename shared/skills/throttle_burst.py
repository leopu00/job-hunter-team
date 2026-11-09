"""throttle_burst.py - during the first burst, a worker that has nothing to do waits a short time, not the Capitano's pause (JHT-T309).

The Capitano's pause (300 s) is the brake against empty rounds. In the first burst it was also the time a position
waited to be picked up: on the measured run (09/11) the Scout's first unit ended with no position, nothing inserted since
the burst began, and the engine gave it the full 300 s; the Analista and the Scorer with an empty queue got 300 s each.
The event wake (event_wake.py, JHT-T297) brings an Analista or a Scorer forward when a position lands in its queue, but it
is a signal and can be lost (debounce, the hourly valve, a wake the agent did not answer); a Scout is woken by nothing.

So in the burst the wait of a worker with nothing to do is capped (`burst_wait.cap_sec` in pause-rules.json):
  - an Analista or a Scorer whose queue was READ and is empty (a queue that cannot be read is no rule);
  - a Scout that has inserted nothing since the burst began.
The cap only ever shortens, and it yields to the spend brake exactly as the other short-pause rules do
(`captains_pause_stays`: recovery after a freeze, team over its pace; the user's burn intent lifts that hold).
Outside the burst nothing changes. The engine passes its own functions in, so this file holds only the rule.
"""
from __future__ import annotations

from typing import Optional


def first_pass_cap(engine: dict, agent: str) -> Optional[dict]:
    """Il conto del primo passaggio se `agent` e' uno Scout nel burst del primo avvio, altrimenti None. Mai solleva."""
    if engine["_role_of"](agent) != "scout":
        return None
    try:
        mod = engine["_load_shared"]("first_run", "first_run.py")
        return mod.sourcing_cap() if mod is not None else None
    except Exception as exc:  # noqa: BLE001 — senza il conto resta la pausa di sempre
        engine["_log"]("could not read the first pass cap: %s" % exc)
        return None


def burst_started_epoch(engine: dict) -> Optional[float]:
    """When the first burst began (epoch), or None when there is no burst running. Never raises, writes nothing."""
    first_run = engine["_load_shared"]("first_run", "first_run.py")
    if first_run is None:
        return None
    state = first_run._read()
    began = first_run._parse(state.get("burst_started_at"))
    if state.get("phase") != first_run.PHASE_BURST or began is None:
        return None
    return began.timestamp()


def wait_cap(engine: dict, agent: str, applied: int, now: float) -> Optional[dict]:
    """`{"cap_sec", "from_sec", "role"}` when `agent`'s pause of `applied` seconds is cut to the burst cap, else None."""
    rule = engine["_RULES"].get("burst_wait") or {}
    cap = int(rule.get("cap_sec") or 0)
    role = engine["_role_of"](agent)
    if cap <= 0 or applied <= cap or role not in (rule.get("roles") or ()):
        return None
    began = burst_started_epoch(engine)
    if began is None:
        return None
    if role == "scout":
        idle = engine["inserted_since"](agent, began) == 0
    else:
        idle = engine["queue_is_empty"](agent)
    if not idle or engine["captains_pause_stays"](now) is not None:
        return None
    return {"cap_sec": cap, "from_sec": applied, "role": role}
