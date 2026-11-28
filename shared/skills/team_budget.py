"""The budget the person declared in the setup: how many dollars, over which period, spread over the working hours.

    "team": {
      "budget": {"usd": 10, "starts_at": "2026-11-15T22:30:00+01:00", "ends_at": "2026-11-18T22:30:00+01:00",
                 "set_by": "setup"},
      "working_hours": {"timezone": "Europe/Rome", "windows": [{"days": ["mon", ...], "start": "08:00", "end": "18:00"}]}
    }

  usd          what the team may spend in the whole period, in dollars (pi prices in dollars).
  starts_at    when the count starts: the spending before it does not count. A new setup writes it again.
  ends_at      when the period ends: from then on the team stays paused.

A budget of a DURATION (a trial of 30 minutes, a few days) has no dates: its period starts when the team starts working,
not when the setup saved it (the onboarding, the download of the full image or a hitch would eat the trial):

      "budget": {"usd": 5, "duration_minutes": 30, "saved_at": "2026-11-15T22:30:00.000Z", "timezone": "Europe/Rome",
                 "set_by": "setup"}

  saved_at          when the setup saved it: the DOLLARS count from here (what the onboarding spends is spent too).
  duration_minutes  how long the period lasts once it starts. The brake (pi_spend_cap.py) starts it at the first call
                    of a Scout (the first real work of search, JHT-T362) after saved_at, and writes the moment in
                    $JHT_HOME/state/budget-start.json ({saved_at, starts_at, ends_at}): the config is the setup's to
                    write, never the brake's. A file of another saved_at is an old one: a new setup starts again.
  Until it starts there is no period and no pace: only the dollars stop the team.

The working hours (working_hours.py) say when the team works inside the period; with none declared it works all the
time. The budget is spread over the WORKED time: by a moment, the team may have spent the share of the budget of the
worked time gone by, plus one working hour ahead (so the first turn has something to start with and the last one can
use what is left).

Pure: a config and a moment in, numbers out. A budget that is not readable (a missing or non-positive `usd`, a date
without its offset, an end not after the start) is no budget, like a `no_quota_cap` that is not a positive number.
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import working_hours  # noqa: E402
from plain_file import read_plain  # noqa: E402

START_FILE = Path("state") / "budget-start.json"
START_MAX_BYTES = 4096

LEAD_SECONDS = 3600  # the working hour the pace allows ahead
FIRST_BURST_SHARE = 0.25  # ... or this share of the budget left at the start, when more: the first burst has something to spend
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


def _usd(raw):
    usd = raw.get("usd")
    if isinstance(usd, bool) or not isinstance(usd, (int, float)) or not math.isfinite(usd) or usd <= 0:
        return None
    return float(usd)


def _minutes(raw):
    value = raw.get("duration_minutes", raw.get("minutes"))
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def recorded_start(home, saved_at):
    """(starts, ends) the brake wrote for the budget saved at `saved_at`, or None (no file, another budget's, unreadable)."""
    if home is None:
        return None
    try:
        record = json.loads(read_plain(Path(home) / START_FILE, max_size=START_MAX_BYTES).decode("utf-8"))
    except Exception:  # noqa: BLE001 - no file, a link or a pipe in its place, broken JSON: not started
        return None
    if not isinstance(record, dict) or record.get("saved_at") != saved_at:
        return None
    starts, ends = _moment(record.get("starts_at")), _moment(record.get("ends_at"))
    return (starts, ends) if starts is not None and ends is not None and ends > starts else None


def read(config, home=None):
    """The budget of `team.budget`, or None when there is none or it is not readable:

    {"usd", "counts_from", "starts", "ends", "duration", "saved_at"} in epoch seconds, and `pace`: True only when the person asked for the pace (`team.budget.pace` true: the brake spreads the budget over the period and pauses a team that runs ahead of it; off, only the budget and the end of the period stop the team). `counts_from` is where the dollars
    count from; `starts`/`ends` the period, None while a budget of a duration has not started (`duration` is its length
    in seconds then, None for a budget with dates). The start of a duration is read from `home` (JHT_HOME)."""
    team = config.get("team") if isinstance(config, dict) else None
    raw = team.get("budget") if isinstance(team, dict) else None
    if not isinstance(raw, dict):
        return None
    usd = _usd(raw)
    if usd is None:
        return None
    minutes = _minutes(raw)
    if minutes is not None:
        saved = _moment(raw.get("saved_at"))
        if saved is None:
            return None
        started = recorded_start(home, raw.get("saved_at"))
        starts, ends = started if started else (None, None)
        return {"usd": usd, "counts_from": saved, "starts": starts, "ends": ends, "duration": minutes * 60.0,
                "saved_at": raw.get("saved_at"), "pace": raw.get("pace") is True}
    starts, ends = _moment(raw.get("starts_at")), _moment(raw.get("ends_at"))
    if starts is None or ends is None or ends <= starts:
        return None
    return {"usd": usd, "counts_from": starts, "starts": starts, "ends": ends, "duration": None, "saved_at": None,
            "pace": raw.get("pace") is True}


def record_start(home, budget, starts, spent_before=0.0):
    """Write the start of a budget of a duration: (starts, ends), and what was spent before it (the onboarding:
    `spent_before_usd`, which `jht team status` says when it is more than half the budget). Replaces the file in one step
    (a link in its place is replaced, never followed). Returns (starts, ends); raises OSError when it cannot be written."""
    ends = starts + budget["duration"]
    path = Path(home) / START_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = lambda moment: datetime.fromtimestamp(moment).astimezone().isoformat(timespec="seconds")  # noqa: E731
    body = json.dumps({"saved_at": budget["saved_at"], "starts_at": stamp(starts), "ends_at": stamp(ends),
                       "spent_before_usd": round(float(spent_before), 6)}) + "\n"
    tmp = path.with_name(".%s.%d.tmp" % (path.name, os.getpid()))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.replace(str(tmp), str(path))
    except BaseException:
        try:
            os.unlink(str(tmp))
        except OSError:
            pass
        raise
    return starts, ends


# The daily ceiling of an older config, `no_quota_cap`: the spending is measured in dollars (pi prices in dollars), so the
# ceiling is one too. `usd` is the key to write. `eur`, the older key, is converted: at `eur_to_usd` when the config gives it,
# else at EUR_TO_USD = 1.0. A euro is worth more than a dollar, so counting it as one stops the team at the ceiling or before it,
# never after; the words say the dollars and, for `eur`, the conversion. `usd` wins when both are there.
EUR_TO_USD = 1.0


def _positive_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def no_quota_cap_usd(config):
    """{"usd", "declared", "currency", "rate"} for the daily ceiling of `no_quota_cap`, or None: `usd` is what the brake compares
    with the spending; `declared` and `currency` are what the config says; `rate` the dollars per euro used (1.0 for `usd`)."""
    cap = config.get("no_quota_cap") if isinstance(config, dict) else None
    if not isinstance(cap, dict):
        return None
    usd = _positive_number(cap.get("usd"))
    if usd is not None:
        return {"usd": usd, "declared": usd, "currency": "USD", "rate": 1.0}
    eur = _positive_number(cap.get("eur"))
    if eur is None:
        return None
    rate = _positive_number(cap.get("eur_to_usd")) or EUR_TO_USD
    return {"usd": round(eur * rate, 6), "declared": eur, "currency": "EUR", "rate": rate}


def margin(usd):
    """What the brake leaves unspent: a call in flight when the brake looks still finishes and is paid."""
    return max(MARGIN_SHARE * usd, MARGIN_USD)


def per_day(config):
    """The budget per day of its period (a period shorter than a day counts as one day), or None without a budget."""
    budget = read(config)
    if budget is None:
        return None
    length = budget["duration"] if budget["duration"] is not None else budget["ends"] - budget["starts"]
    return budget["usd"] / max(1.0, length / 86400.0)


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


def lead(budget, total):
    """What the pace allows ahead: one working hour of the budget, or FIRST_BURST_SHARE of it when more, so the first burst
    of a small budget (2 $ over a day: one hour is 0.08 $) can still search."""
    return max(budget["usd"] * LEAD_SECONDS / total, FIRST_BURST_SHARE * budget["usd"])


def allowed(config, budget, now):
    """What the team may have spent by `now`: the share of the worked time gone by plus the lead, at most the whole budget.
    A period with no working time in it allows the whole budget (the gate keeps the team still anyway)."""
    intervals = worked_intervals(config, budget["starts"], budget["ends"])
    total = sum(hi - lo for lo, hi in intervals)
    if total <= 0:
        return budget["usd"]
    return min(budget["usd"], budget["usd"] * _worked_until(intervals, now) / total + lead(budget, total))


def resumes_at(config, budget, spent):
    """The first moment the pace allows more than `spent`, or None if it never does inside the period."""
    intervals = worked_intervals(config, budget["starts"], budget["ends"])
    total = sum(hi - lo for lo, hi in intervals)
    if total <= 0 or spent >= budget["usd"]:
        return None
    need = (spent - lead(budget, total)) * total / budget["usd"]  # worked seconds after which the allowance passes `spent`
    gone = 0.0
    for lo, hi in intervals:
        if gone + (hi - lo) > need:
            return lo + max(0.0, need - gone)
        gone += hi - lo
    return None
