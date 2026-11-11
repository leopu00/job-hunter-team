"""throttle_burst.py - during the first burst, a worker that has nothing to do waits a short time, not the Capitano's pause (JHT-T309).

The Capitano's pause (300 s) is the brake against empty rounds. In the first burst it was also the time a position
waited to be picked up: on the measured run (09/11) the Scout's first unit ended with no position, nothing inserted since
the burst began, and the engine gave it the full 300 s; the Analista and the Scorer with an empty queue got 300 s each.
The event wake (event_wake.py, JHT-T297) brings an Analista or a Scorer forward when a position lands in its queue, but it
is a signal and can be lost (debounce, the hourly valve, a wake the agent did not answer); a Scout is woken by nothing.

So in the burst the wait of a worker with nothing to do is capped (`burst_wait.cap_sec` in pause-rules.json):
  - an Analista or a Scorer whose queue was READ and is empty (a queue that cannot be read is no rule);
  - a Scout that has inserted nothing since the burst began;
  - a Scout that HAS inserted waits at most `scout_after_insert.cap_sec` after each position, while the sources are not refusing it.
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


def suspended_sources(engine: dict, now: float) -> Optional[int]:
    """How many sources the Scouts are refused by right now (source_rate.py: a 403/429/503 suspends a source for everyone).
    None when that cannot be read: the caller then keeps the pause as it was. Never raises."""
    try:
        mod = engine["_load_shared"]("source_rate", "source_rate.py")
        if mod is None:
            return None
        return sum(1 for row in mod.status(now=now).values() if "suspended_until" in row)
    except Exception as exc:  # noqa: BLE001
        engine["_log"]("could not read the source pauses: %s" % exc)
        return None


def _scout_after_insert(engine: dict, rule: dict, agent: str, applied: int, now: float) -> Optional[dict]:
    """A Scout that HAS inserted in the burst is no longer 'idle', but its unit is one position and the first pass has its own
    ceiling (first_pass_cap, handled by the engine before this rule): the Capitano's 300 s after each insert is the pace of a
    steady day, not of the burst. Measured 11/11: 15 of the 16 Scout pauses were 300 s after an insert, half of the Scouts'
    time asleep, 17 positions in 30 minutes. So after an insert the pause is capped at `scout_after_insert.cap_sec`, unless
    the pause is longer than `max_from_sec` (a deliberate slow-down), the spend brake holds the Capitano's pause or the sources are refusing the Scouts: `max_suspended_sources` or more
    sources suspended by source_rate.py (or a state that cannot be read) and the pause stays."""
    after = rule.get("scout_after_insert") or {}
    cap = int(after.get("cap_sec") or 0)
    longest = int(after.get("max_from_sec") or 0)
    if cap <= 0 or applied <= cap or engine["captains_pause_stays"](now) is not None:
        return None
    if longest > 0 and applied > longest:
        return None       # a pause longer than the Capitano's usual one was set on purpose: it stays, it is never shortened
    suspended = suspended_sources(engine, now)
    limit = after.get("max_suspended_sources")
    if suspended is None or (isinstance(limit, int) and limit > 0 and suspended >= limit):
        return None
    return {"cap_sec": cap, "from_sec": applied, "role": "scout", "after_insert": True}


def wait_cap(engine: dict, agent: str, applied: int, now: float) -> Optional[dict]:
    """`{"cap_sec", "from_sec", "role"}` when `agent`'s pause of `applied` seconds is cut to the burst cap, else None."""
    rule = engine["_RULES"].get("burst_wait") or {}
    cap = int(rule.get("cap_sec") or 0)
    role = engine["_role_of"](agent)
    if cap <= 0 or role not in (rule.get("roles") or ()):
        return None
    began = burst_started_epoch(engine)
    if began is None:
        return None
    if role == "scout" and engine["inserted_since"](agent, began) > 0:
        return _scout_after_insert(engine, rule, agent, applied, now)
    if applied <= cap:
        return None
    if role == "scout":
        idle = True
    else:
        idle = engine["queue_is_empty"](agent)
    if not idle or engine["captains_pause_stays"](now) is not None:
        return None
    return {"cap_sec": cap, "from_sec": applied, "role": role}
