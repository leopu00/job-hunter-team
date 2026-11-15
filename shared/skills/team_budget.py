"""The budget the person declared in the setup: how many dollars, over which period, spread over the working hours.

    "team": {
      "budget": {"usd": 10, "starts_at": "2026-11-15T22:30:00+01:00", "ends_at": "2026-11-18T22:30:00+01:00",
                 "set_by": "setup"},
      "working_hours": {"timezone": "Europe/Rome", "windows": [{"days": ["mon", ...], "start": "08:00", "end": "18:00"}]}
    }

  usd          what the team may spend in the whole period, in dollars (pi prices in dollars).
  starts_at    when the count starts: the spending before it does not count. A new setup writes it again.
  ends_at      when the period ends: from then on the team stays paused.

The working hours (working_hours.py) say when the team works inside the period; with none declared it works all the
time. The budget is spread over the WORKED time: by a moment, the team may have spent the share of the budget of the
worked time gone by, plus one working hour ahead (so the first turn has something to start with and the last one can
use what is left).

Pure: a config and a moment in, numbers out. A budget that is not readable (a missing or non-positive `usd`, a date
without its offset, an end not after the start) is no budget, like a `no_quota_cap` that is not a positive number.
"""

from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import working_hours  # noqa: E402

LEAD_SECONDS = 3600  # the working hour the pace allows ahead
MARGIN_SHARE, MARGIN_USD = 0.02, 0.10  # the brake stops this much before the budget: max(2 %, 0.10 $)


def _moment(value):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.timestamp() if moment.tzinfo is not None else None  # a date without its offset is ambiguous


def read(config):
    """{"usd", "starts", "ends"} (epoch seconds) from `team.budget`, or None when there is none or it is not readable."""
    team = config.get("team") if isinstance(config, dict) else None
    raw = team.get("budget") if isinstance(team, dict) else None
    if not isinstance(raw, dict):
        return None
    usd = raw.get("usd")
    if isinstance(usd, bool) or not isinstance(usd, (int, float)) or not math.isfinite(usd) or usd <= 0:
        return None
    starts, ends = _moment(raw.get("starts_at")), _moment(raw.get("ends_at"))
    if starts is None or ends is None or ends <= starts:
        return None
    return {"usd": float(usd), "starts": starts, "ends": ends}


def margin(usd):
    """What the brake leaves unspent: a call in flight when the brake looks still finishes and is paid."""
    return max(MARGIN_SHARE * usd, MARGIN_USD)


def per_day(config):
    """The budget per day of its period (a period shorter than a day counts as one day), or None without a budget."""
    budget = read(config)
    if budget is None:
        return None
    return budget["usd"] / max(1.0, (budget["ends"] - budget["starts"]) / 86400.0)


def timezone_of(config):
    """The person's zone: the budget's own `timezone`, else the one of the working hours; None for the local zone of the
    machine. The intervals of the working hours are always computed in the zone of the working hours, as the gate does."""
    team = config.get("team") if isinstance(config, dict) else None
    budget = team.get("budget") if isinstance(team, dict) else None
    zone = _zone(budget.get("timezone") if isinstance(budget, dict) else None)
    return zone if zone is not None else hours_zone(config)


def _zone(name):
    if not isinstance(name, str) or not name.strip() or working_hours.ZoneInfo is None:
        return None
    try:
        return working_hours.ZoneInfo(name.strip())
    except Exception:  # noqa: BLE001 - an unknown zone: the local one, as the working hours gate does
        return None


def hours_zone(config):
    """The zone of the working hours as the gate reads it: none written is UTC, an unknown one the local zone (None)."""
    team = config.get("team") if isinstance(config, dict) else None
    hours = team.get("working_hours") if isinstance(team, dict) else None
    if not isinstance(hours, dict):
        return None
    name = hours.get("timezone")
    return _zone((name.strip() if isinstance(name, str) else "") or "UTC")


def _windows(config):
    team = config.get("team") if isinstance(config, dict) else None
    hours = team.get("working_hours") if isinstance(team, dict) else None
    windows = hours.get("windows") if isinstance(hours, dict) else None
    out = []
    for window in windows if isinstance(windows, list) else []:
        if not isinstance(window, dict):
            continue
        try:
            start, end = working_hours._parse_hhmm(str(window["start"])), working_hours._parse_hhmm(str(window["end"]))
        except Exception:  # noqa: BLE001 - the gate skips such a window too
            continue
        days = {working_hours._WEEKDAY_INDEX[d] for d in (window.get("days") or []) if d in working_hours._WEEKDAY_INDEX}
        if days:
            out.append((days, start, end))
    return out


def worked_intervals(config, starts, ends):
    """The working time inside [starts, ends) as sorted, disjoint (from, to) epoch pairs. No working hours declared, or
    none readable: the whole period, as the gate lets the team work 24/7 then."""
    windows = _windows(config)
    if not windows:
        return [(starts, ends)] if ends > starts else []
    zone = hours_zone(config)
    first = datetime.fromtimestamp(starts, zone).date() - timedelta(days=1)  # a night window of the day before
    last = datetime.fromtimestamp(ends, zone).date()
    pieces = []
    day = first
    while day <= last:
        for days, start, end in windows:
            if day.weekday() not in days:
                continue
            begin = datetime.combine(day, start, zone)
            # start > end runs into the next day; start == end would be a window of nothing, which the gate never
            # opens (its own test is start <= t < end), so it is no working time here either.
            if start == end:
                continue
            finish = datetime.combine(day + timedelta(days=1) if end < start else day, end, zone)
            lo, hi = max(begin.timestamp(), starts), min(finish.timestamp(), ends)
            if hi > lo:
                pieces.append((lo, hi))
        day += timedelta(days=1)
    pieces.sort()
    merged = []
    for lo, hi in pieces:
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return merged


def _worked_until(intervals, moment):
    return sum(max(0.0, min(hi, moment) - lo) for lo, hi in intervals)


def allowed(config, budget, now):
    """What the team may have spent by `now`: the share of the worked time gone by, one working hour ahead, at most the
    whole budget. A period with no working time in it allows the whole budget (the gate keeps the team still anyway)."""
    intervals = worked_intervals(config, budget["starts"], budget["ends"])
    total = sum(hi - lo for lo, hi in intervals)
    if total <= 0:
        return budget["usd"]
    return min(budget["usd"], budget["usd"] * (_worked_until(intervals, now) + LEAD_SECONDS) / total)


def resumes_at(config, budget, spent):
    """The first moment the pace allows more than `spent`, or None if it never does inside the period."""
    intervals = worked_intervals(config, budget["starts"], budget["ends"])
    total = sum(hi - lo for lo, hi in intervals)
    if total <= 0 or spent >= budget["usd"]:
        return None
    need = spent * total / budget["usd"] - LEAD_SECONDS  # worked seconds after which the allowance passes `spent`
    gone = 0.0
    for lo, hi in intervals:
        if gone + (hi - lo) > need:
            return lo + max(0.0, need - gone)
        gone += hi - lo
    return None
