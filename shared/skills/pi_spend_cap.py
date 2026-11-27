"""A spending brake for the agents on the pi harness: the cost pi measures, against the ceiling the person declared.

An access with no quota data (an API key, or a team made only of pi agents: see quota_data.py) has no 5h or weekly
window to pace by, so nothing stopped the spending but the ceiling set with the provider. pi writes the cost of every
call in its session files (pi_sessions.py), so the spending is now measured. Here it is compared, on every tick of the
Sentinella, with the ceiling the config declares:

  "no_quota_cap": {"eur": 10, "tokens_per_hour": 500000}

  eur               what pi spent TODAY (local day). pi prices in dollars and the figure is compared as it is, one to
                    one. It is pi's own cost per call plus the web search fee. pi's price for a cache write is the
                    provider's (1.25x the input for the default 30 minutes), so the figure follows the invoice; it
                    falls BELOW it only for a call above 272k input tokens (the long-context tier is not in pi's cost),
                    so the brake can come late by that surcharge, never by the cache.
  tokens_per_hour   what pi's agents processed or produced in the last hour: input, cache writes, output (a cache
                    read is a tenth of the price and is left out).

  below the ceiling    nothing.
  at the ceiling       a DECLARED pause: the Captain and the person are told, the daily-halt flag is raised (ESC to
                       every session, no forced kill, the same brake the daily cap uses), tagged with its reason. It is
                       lifted by the same tick that sees the spending back under the ceiling (the next day for `eur`,
                       less than an hour later for `tokens_per_hour`) or when a burn-intent is in force. Not a FATAL.
  no ceiling declared  the person is told once a day how much pi spent and that nothing stops it.

The budget of the setup (team_budget.py: `team.budget`, dollars over a period, spread over the working hours) is read
before `no_quota_cap` and counts from its own start, not from midnight. Three pauses come from it:

  budget     spent >= usd - max(2 %, 0.10 $). The brake looks every ~5 minutes and a call in flight is still paid, so it
             stops a little before. It does not lift by itself: a new budget (jht setup) lifts it.
  period     the period is over. It does not lift by itself either.
  pace       spent above the share of the budget of the worked time gone by (one working hour ahead): it lifts by itself
             when the worked time catches up, and the person is told when.

It runs only in the NO-QUOTA mode (the ceiling is called `no_quota_cap` for that reason): with quota data the windows and
the daily cap pace the team, and they would lift this pause as if it were theirs.

Nothing here raises into the tick: a reading that fails is a warning in the log and the tick goes on.
"""

from __future__ import annotations

import json
import math
import stat
import os
import re
import sqlite3
from pathlib import Path
from datetime import datetime

import pi_sessions
import provider_credit
import quota_data
import team_budget

REASON = "pi_spend_cap"
# How often the brake looks at the spending: between two ticks of the Sentinella too (sentinel_loop._sleep_watching_the_spending).
CHECK_EVERY_SEC = 60
# The spending of the last minutes, as a pace: what the team will have spent by the next look is that pace times CHECK_EVERY_SEC.
RATE_WINDOW_SEC = 300
# The first seconds after a resume: the sessions that wake rewrite their cache (0.45 $ in 31 s, Linux 12b) before they work. That
# cost is the budget's (its hard stop counts it) and not the pace's: a pace that counts it stops the team again 80 s after every resume.
RESTART_WINDOW_SEC = 120
RESUMES_FILE = Path("state") / "pace-resumes.json"
WAKES_FILE = Path("state") / "pace-wakes.json"            # [[moment, estimate, {session: estimate}]]: what the sessions woken at that moment were expected to cost
QUEUE_FILE = Path("state") / "pace-wake-queue.json"       # {"pending": [...], "at": moment}: the sessions the pace has not woken yet
PROVIDER_NAMES = provider_credit.PROVIDER_NAMES


def _positive(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def ceilings(config):
    """(eur, tokens_per_hour) as declared in `no_quota_cap`; None for each that is absent or not a positive number."""
    cap = config.get("no_quota_cap") if isinstance(config, dict) else None
    if not isinstance(cap, dict):
        return None, None
    return _positive(cap.get("eur")), _positive(cap.get("tokens_per_hour"))


def day_start(now_ts):
    """The epoch second of the local midnight that starts the day of `now_ts`."""
    return datetime.fromtimestamp(now_ts).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


WORKER_ROLES = ("scout", "analista", "scorer")  # the first call of one of them starts a budget of a duration


def _is_worker(agent):
    return isinstance(agent, str) and agent.split("-", 1)[0] in WORKER_ROLES


FLAG_MAX_BYTES = 1024 * 1024   # the flag of the halt carries the signatures of the panes: the bridge writes it, a few KiB
STATE_MAX_BYTES = 64 * 1024   # like the gate in the session (spend-gate.js): a state file of the pace is a few lines


def _read_state(path, limit=STATE_MAX_BYTES):
    """The JSON of a state file of the brake, or None for anything else: absent, too big, not JSON, an integer of 400 digits, 100000
    brackets deep. The agents can write these files, and a file that cannot be read is an empty one: it never stops a look of the
    brake (the hard cap included), and the next write of the brake replaces it."""
    try:
        # a plain file only: opened without waiting (a pipe with no writer would hold the look of the brake for ever) and without
        # following a link; a pipe, a link, a folder or a device is an empty file
        fd = os.open(str(path), os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                return None
            raw = os.read(fd, limit + 1)
        finally:
            os.close(fd)
        if len(raw) > limit:
            return None
        return json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001 - OverflowError and RecursionError among them
        return None


def _read_resumes(home):
    data = _read_state(Path(home) / RESUMES_FILE)
    try:
        return [float(x) for x in data if _sound(x)] if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def _write_state(path, data):
    """Atomic, 0600. Best effort: the brake goes on without it."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(".%s.%d.tmp" % (path.name, os.getpid()))
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(data))
        os.replace(str(tmp), str(path))
    except OSError:
        pass


def note_resume(home, moment):
    """The moment the pace let the team work again, for the pace to leave the restart out of its rate. Best effort, atomic, 0600."""
    _write_state(Path(home) / RESUMES_FILE, (_read_resumes(home) + [float(moment)])[-50:])


SPEND_NOW_FILE = Path("state") / "spend-now.json"         # what the team has spent and at what rate, written at every look of the brake
STOP_AT_FILE = Path("state") / "spend-stop-at.json"       # {"usd", "set_at", "by"}: the stop the Captain committed to, applied as a ceiling
MEASURE_WINDOW_SEC = 600   # the rate the Captain projects with: the measured spending of the last ten minutes, not a unit cost


def measured(home, now_ts, window_sec=MEASURE_WINDOW_SEC):
    """What the team spent in the last `window_sec`, in dollars and dollars per minute, per session too. The Captain's projections
    were made with a cost per worker he made up (0.011 $/min) when the team spent 0.15 $/min (collaudo W1 26/11): this is the measure."""
    since = now_ts - window_sec
    by_agent = {}
    for event in list(pi_sessions.usage_events(home, since)) + list(pi_sessions.search_events(home, since)):
        if event["ts"] < since or event["ts"] > now_ts:
            continue
        name = (event.get("agent") or "?").upper()
        by_agent[name] = by_agent.get(name, 0.0) + event["cost"]
    minutes = window_sec / 60.0
    usd = sum(by_agent.values())
    workers = {name: cost for name, cost in by_agent.items() if _WORKER_SESSION.match(name)}
    return {"window_min": round(minutes, 1), "usd": round(usd, 6), "usd_per_min": round(usd / minutes, 6),
            "by_agent_usd_per_min": {name: round(cost / minutes, 6) for name, cost in sorted(by_agent.items())},
            "workers": len(workers), "workers_usd_per_min": round(sum(workers.values()) / minutes, 6)}


def read_stop_at(home):
    """The stop the Captain committed to, or None. A file that cannot be read, or a figure that is not a positive number, is no stop."""
    data = _read_state(Path(home) / STOP_AT_FILE)
    if not isinstance(data, dict):
        return None
    usd = _positive(data.get("usd"))
    if usd is None:
        return None
    return {"usd": float(usd), "set_at": data.get("set_at") if isinstance(data.get("set_at"), str) else None,
            "by": data.get("by") if isinstance(data.get("by"), str) else None}


def counted(spent, budget):
    """The figure the person reads and the stop is set on: since the start of the budget when there is one, else today."""
    if budget is not None and spent.get("budget_cost") is not None:
        return float(spent["budget_cost"]), "budget"
    return float(spent.get("cost") or 0.0), "today"


def write_spend_now(home, now_ts, spent, budget, rate, stop):
    """state/spend-now.json, at every look: the figure of `jht team status` and of the chat is never the first one told (W1 F-09:
    «0.06 USD» stayed for the whole afternoon)."""
    figure, counts = counted(spent, budget)
    _write_state(Path(home) / SPEND_NOW_FILE, {
        "at": int(now_ts), "spent_usd": round(figure, 6), "counts": counts, "today_usd": round(float(spent.get("cost") or 0.0), 6),
        "budget_usd": budget["usd"] if budget is not None else None, "usd_per_min": rate["usd_per_min"],
        "window_min": rate["window_min"], "workers": rate["workers"], "workers_usd_per_min": rate["workers_usd_per_min"],
        "stop_at_usd": stop["usd"] if stop else None})


def _sound(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0


def _read_wakes(home):
    data = _read_state(Path(home) / WAKES_FILE)
    try:
        out = []
        for row in data:
            m, e = row[0], row[1]
            per = row[2] if len(row) > 2 and isinstance(row[2], dict) else None
            # a file the agents can write: only finite, non-negative numbers (json.loads lets NaN and -Infinity through)
            if _sound(m) and _sound(e):
                out.append((float(m), float(e), {str(k).upper(): float(v) for k, v in per.items() if _sound(v)} if per is not None else None))
        return out
    except Exception:  # noqa: BLE001
        return []


def note_wake(home, moment, estimate, per_session=None):
    """A stage of the wake: the moment (a resume, for the rate and the look) and what its sessions are expected to cost, which the
    pace keeps under the line for the next two minutes, session by session: the reserve of one closes with its first turn after the
    wake, when what it really cost is in the spend (`per_session`: {name: estimate})."""
    note_resume(home, moment)
    row = [float(moment), round(float(estimate), 6)] + ([{k: round(float(v), 6) for k, v in per_session.items()}] if per_session else [])
    kept = [[m, e] + ([per] if per is not None else []) for m, e, per in _read_wakes(home)]
    _write_state(Path(home) / WAKES_FILE, (kept + [row])[-50:])


def pending_wakes(home):
    data = _read_state(Path(home) / QUEUE_FILE)
    try:
        # a file the agents can write: only names of sessions of the team that a resume wakes, never the ones kept still on purpose
        return [x for x in (data.get("pending") or []) if isinstance(x, str) and _AGENT_SESSION.match(x)
                and x not in NEVER_WAKE and x not in WAKE_ONLY_IF_NEEDED and x not in ALWAYS_WOKEN]
    except Exception:  # noqa: BLE001
        return []


QUEUE_STALE_SEC = 2 * 3600    # a queue nobody has touched for this long is not one the pace is still working through


def waiting(home, now_ts):
    """The sessions that still wait for their stage of the pace: nobody else wakes them before it (the throttle, the Dottore's
    unblock, the Dottore itself). A queue that is old is a queue left behind, not a wait."""
    try:
        at = float(_read_state(Path(home) / QUEUE_FILE).get("at") or 0)
    except Exception:  # noqa: BLE001
        return []
    return pending_wakes(home) if 0 <= now_ts - at <= QUEUE_STALE_SEC else []


SETTLE_SEC = 20 * 60    # after a wake the team needs this long to speak again before its silence counts as a block


def settling(home, now_ts):
    """True for SETTLE_SEC after the pace woke the team: its silence from before the pause is not a block yet."""
    try:
        last = max(_read_resumes(home) or [0.0])
    except Exception:  # noqa: BLE001
        return False
    return 0 <= now_ts - last <= SETTLE_SEC


def paused(home):
    """True while the flag of the brake holds the team (a plain file with its reason)."""
    try:
        payload = _read_state(Path(home) / "logs" / "daily-halt.flag", FLAG_MAX_BYTES)
        return isinstance(payload, dict) and payload.get("reason") == "pi_spend_cap"
    except Exception:  # noqa: BLE001
        return False


def set_pending(home, names, moment):
    _write_state(Path(home) / QUEUE_FILE, {"pending": list(names), "at": float(moment)})


def spend(home, now_ts, budget_start=None, split_at=None):
    """What pi spent: `cost` today (dollars: pi's estimate plus the fee of the web searches), `hour_tokens` in the last hour,
    `calls` today, `budget_cost` since `budget_start` when a budget is declared (else None), and `first_worker`, the
    moment of the first call of a worker since `budget_start` (None without one). `before_start` is what was spent from
    `budget_start` to `split_at` (the start of the period), or to that first call when `split_at` is None: the onboarding."""
    start, hour = day_start(now_ts), now_ts - 3600
    out = {"cost": 0.0, "hour_tokens": 0, "calls": 0, "credit": provider_credit.exhausted(home, now_ts),
           "budget_cost": None if budget_start is None else 0.0, "first_worker": None,
           "recent_cost": 0.0, "before_start": 0.0, "restart_cost": 0.0, "restart_recent": 0.0, "since_resume": None, "reserve_open": 0.0}
    budget_events = []
    calls = {}    # {SESSION: [moment of each of its calls since the budget started]}
    # the rate of the pace is the team's since the last resume, not the pause before it (see _budget_verdict)
    resumed_at = [r for r in _read_resumes(home) if budget_start is not None and budget_start <= r <= now_ts]
    recent_from = max(now_ts - RATE_WINDOW_SEC, max(resumed_at, default=0.0))
    since = min(start, hour) if budget_start is None else min(start, hour, budget_start)
    for event in pi_sessions.usage_events(home, since):
        if event["ts"] >= start:
            out["cost"] += event["cost"]
            out["calls"] += 1
        if event["ts"] >= hour:
            out["hour_tokens"] += event["input"] + event["cache_write"] + event["output"]
        if budget_start is not None and event["ts"] >= budget_start:
            out["budget_cost"] += event["cost"]
            budget_events.append((event["ts"], event["cost"]))
            calls.setdefault((event.get("agent") or "").upper(), []).append(event["ts"])
            if event["ts"] >= recent_from:
                out["recent_cost"] += event["cost"]
            if out["first_worker"] is None and _is_worker(event.get("agent")):
                out["first_worker"] = event["ts"]  # the events come oldest first
    for event in pi_sessions.search_events(home, since):  # the fee of a search call, which pi does not price
        if event["ts"] >= start:
            out["cost"] += event["cost"]
        if budget_start is not None and event["ts"] >= budget_start:
            out["budget_cost"] += event["cost"]
            budget_events.append((event["ts"], event["cost"]))
            if event["ts"] >= recent_from:
                out["recent_cost"] += event["cost"]
    split = split_at if split_at is not None else out["first_worker"]
    if split is not None:
        out["before_start"] = round(sum(cost for moment, cost in budget_events if moment < split), 6)
    if budget_start is not None:
        for resumed in _read_resumes(home):
            if resumed < budget_start:
                continue
            if resumed <= now_ts and (out["since_resume"] is None or now_ts - resumed < out["since_resume"]):
                out["since_resume"] = now_ts - resumed
            for moment, cost in budget_events:
                if resumed <= moment < resumed + RESTART_WINDOW_SEC:
                    out["restart_cost"] += cost
                    if moment >= recent_from:
                        out["restart_recent"] += cost
        out["restart_cost"] = round(out["restart_cost"], 6)
        # the stages woken in the last two minutes: what they were expected to cost and has not been spent yet stays under the line
        # a session that has made its first turn after the wake has its real reload in the spend: its reserve is closed, and never
        # counted a second time (retest 19/11: every resume paused within 10-47 s, the estimate 5 times the real cost kept under the line)
        open_wakes = [w for w in _read_wakes(home) if w[0] >= budget_start and 0 <= now_ts - w[0] < RESTART_WINDOW_SEC]
        reserve = 0.0
        for moment, estimate, per in open_wakes:
            if per is None:   # a wake written before the per-session estimates: the whole estimate less what the team has spent since
                paid = sum(cost for when, cost in budget_events if when >= moment)
                reserve += max(0.0, estimate - paid)
            else:
                reserve += sum(cost for name, cost in per.items() if not any(t >= moment for t in calls.get(name, ())))
        out["reserve_open"] = round(reserve, 6)
    out["cost"] = round(out["cost"], 6)
    if budget_start is not None:
        out["budget_cost"] = round(out["budget_cost"], 6)
    return out


PACE_SLACK = True              # the pace stops one margin before the line, like the budget, and says the resume time the lift will really find (the same line: reserve + one margin)
RESTART_RESERVE_SHARE = 0.10   # a team stopped by the pace comes back only with this share of the budget of room under the pace
RESTART_COST_PER_SESSION = 0.07  # what a session costs to start again: it reloads its context (0.52 $ for 8 sessions, giro Linux build15; 0.454 $ in 12b)
WATCH_AFTER_RESUME_SEC = 300   # for this long after a resume the brake looks every LOOK_AFTER_RESUME_SEC: the restart is the fast part
LOOK_AFTER_RESUME_SEC = 15


WORK_MULTIPLE = 3.0     # a session is woken, and the pause lifted, when the room covers its reload AND as much work again twice over: the team works some minutes before the next pause (retest 8d5f09a2b: Captain + Scout, 0.30 $ of reload, ate the whole room and the team stopped 33 s after every resume)
RELOAD_GAP_SEC = 300    # a session silent for this long has lost its cache: its next turn is a reload
MIN_RELOAD_COST = 0.01
# what the first turn of a session costs after a stop, by role, from the retest data (Scout 0.16-0.24 $, Captain ~0.17-0.19 $, Scorer 0.15-0.16 $, retest 22b3c6eab):
# the least a session is expected to cost, whatever its history says (a turn whose cache was still warm measured 0.01 $ and the room of the
# stage was too little) and what a session with no history costs
ROLE_RELOAD_COST = {"SCOUT": 0.22, "CAPITANO": 0.19, "SCORER": 0.16}
ALWAYS_WOKEN = ("CAPITANO", "SENTINELLA")   # told by their own notice at a resume: their reload is reserved, they are not staged


def session_costs(home, now, sessions):
    """{session: what it costs to start again}: the context of its last call times the price its model was paid, the dearest cost per
    token of a call of that model that wrote its cache (RESTART_COST_PER_SESSION at least, and for a session with no history).
    The Scorer on Sonnet reloaded 75k tokens for 0.197 $ of the 0.52 $ that eight sessions cost (giro Linux build15)."""
    names = [x for x in (sessions or []) if isinstance(x, str) and x not in NEVER_WAKE and x not in WAKE_ONLY_IF_NEEDED]
    if not names:
        return {}
    last, rate, reload, before = {}, {}, {}, {}
    try:
        for event in pi_sessions.usage_events(home, now - 86400):
            who = (event.get("agent") or "").upper()
            if who:
                last[who] = event
                if who in before and event["ts"] - before[who] >= RELOAD_GAP_SEC and event.get("cost"):
                    reload[who] = event["cost"]   # its first turn after a stop: what the restart really cost it
                before[who] = event["ts"]
            tokens = (event.get("input") or 0) + (event.get("cache_write") or 0)
            if event.get("model") and tokens >= 2000 and event.get("cache_write"):
                rate[event["model"]] = max(rate.get(event["model"], 0.0), event["cost"] / tokens)
    except Exception:  # noqa: BLE001 - without the history every session costs the minimum
        pass
    costs = {}
    for name in names:
        event = last.get(name.upper())
        cost = 0.0
        floor = max(MIN_RELOAD_COST, ROLE_RELOAD_COST.get(name.upper().split("-", 1)[0], 0.0))
        if name.upper() in reload:
            costs[name] = round(max(floor, reload[name.upper()]), 6)
            continue
        if event and event.get("model") in rate:
            cost = ((event.get("input") or 0) + (event.get("cache_read") or 0) + (event.get("cache_write") or 0)) * rate[event["model"]]
        costs[name] = round(max(RESTART_COST_PER_SESSION, floor, cost), 6)
    return costs


def _known_sessions(home, now):
    """The sessions of the team that spent in the last day: the ones a lift of the pace would wake."""
    try:
        names = {(event.get("agent") or "").upper() for event in pi_sessions.usage_events(home, now - 86400)}
    except Exception:  # noqa: BLE001
        return []
    return sorted(x for x in names if _AGENT_SESSION.match(x) and x not in NEVER_WAKE and x not in WAKE_ONLY_IF_NEEDED)


def _team_sessions(api, home, now, flag):
    names = set((flag or {}).get("sessions") or []) | set(_known_sessions(home, now))
    try:
        lister = getattr(api, "list_tmux_sessions", None)
        names |= {x for x in (lister() if lister else []) if isinstance(x, str) and _AGENT_SESSION.match(x)}
    except Exception:  # noqa: BLE001
        pass
    return sorted(names)


def restart_estimate(home, now, sessions):
    """What waking all these sessions together would cost."""
    return round(sum(session_costs(home, now, sessions).values()), 6)


def first_stage_cost(home, now, sessions):
    """What a lift of the pace needs under the line: the sessions that are always woken and the cheapest of the others. The rest is
    woken by stages as the line rises (a team stopped for 24 h with 1.08 $ unspent, retest of the brake)."""
    costs = session_costs(home, now, sessions)
    fixed = sum(c for n, c in costs.items() if n in ALWAYS_WOKEN)
    others = [c for n, c in costs.items() if n not in ALWAYS_WOKEN]
    return round(fixed + (min(others) if others else 0.0), 6)


def _wake_rank(session):
    """Who comes first: the Scouts (nothing enters without them), then the Scorer and the Analysts, the other workers, the Dottore,
    the Mantenitore, the rest; by number inside a group."""
    match = re.match(r"^([A-Z]+)(?:-S?(\d+))?$", session or "")
    kind, number = (match.group(1), int(match.group(2) or 0)) if match else (session or "", 0)
    order = {"SCOUT": 0, "SCORER": 1, "ANALISTA": 2}
    if kind in order:
        group = order[kind]
    elif _WORKER_SESSION.match(session or ""):
        group = 3
    else:
        group = {"DOTTORE": 4, "MANTENITORE": 5}.get(kind, 6)
    return (group, number, session or "")


def _stage_room(config, budget, spent, now):
    """What the line leaves for sessions that start now: the pace allowance, less one margin, less what was spent and what the stages
    of the last two minutes are still expected to spend. Infinite without a budget that has started: there is no line."""
    if budget is None:
        return float("inf")
    used = spent.get("budget_cost") or 0.0
    if budget.get("starts") is None:
        # a budget of a duration that has not started (the unblock after a new one): the period starts with the first work, which is
        # the one these sessions are about to do. The line at that first instant is the lead, not «no line» (retest 19/11: eight
        # sessions started together on a budget of 0.91 $ and the pause came 48 s later)
        if not budget.get("duration"):
            return float("inf")
        budget = dict(budget, starts=now, ends=now + budget["duration"])
        before = used
    else:
        before = min(spent.get("before_start") or 0.0, used)
    period = dict(budget, usd=budget["usd"] - before)
    if period["usd"] <= 0:
        return float("inf")
    allowance = team_budget.allowed(config, period, now)
    slack = team_budget.margin(period["usd"]) if PACE_SLACK else 0.0
    return max(0.0, allowance - slack - (used - before) - (spent.get("reserve_open") or 0.0))


class Stage:
    """The room of one look: a session is woken when its estimated reload fits, in the order given; the others wait."""

    def __init__(self, room, costs):
        self.room, self.costs, self.estimate, self.pending, self.taken, self.woken = room, costs, 0.0, [], 0, {}

    def reserve(self, name):
        cost = self.costs.get(name, 0.0)
        self.room -= cost   # the Captain and the Sentinella are told by their own notice whatever the room: their reload only, the work is theirs to ask
        self.estimate += cost
        self.woken[name] = cost

    def take(self, name):
        """The sessions go in the order given and nobody overtakes: one whose reload does not fit holds the ones behind it (the Scouts
        have the dearest reload, and the cheaper sessions behind them were taking the room, retest 19/11). The first of a stage goes
        alone even when its reload is more than the room, as long as there is room at all: the hard stop of the brake is behind it,
        and otherwise the first in the order would never start."""
        cost = self.costs.get(name, RESTART_COST_PER_SESSION)
        need = cost * WORK_MULTIPLE   # the reload and the work after it: the room is for the team to work, not only to start
        first = self.taken == 0 and not self.pending
        if not self.pending and (need <= self.room + 1e-9 or (first and self.room > 1e-9)):
            self.room -= need
            self.estimate += cost
            self.woken[name] = cost
            self.taken += 1
            return True
        self.pending.append(name)
        return False


def look_every(home, now):
    """Seconds between two looks of the brake: short in the minutes after a resume, when the team spends the most."""
    try:
        last = max([r for r in _read_resumes(home) if r <= now], default=None)
    except Exception:  # noqa: BLE001
        last = None
    if last is not None and now - last < WATCH_AFTER_RESUME_SEC:
        return float(LOOK_AFTER_RESUME_SEC)
    return float(CHECK_EVERY_SEC)


def _budget_verdict(config, budget, spent, now, held_by_pace=False, restart_estimate=0.0):
    """The pause the budget asks for, or None. `held_by_pace`: the team is paused by the pace right now; it then stays paused until
    the pace leaves the room a restart costs (seven sessions starting together rewrite their cache: 0.85 $ in 86 s, giro Linux
    18/11, with the pace lifted at the very dollar it had stopped on)."""
    used = spent.get("budget_cost") or 0.0
    # What the team will have spent by the next look, at the pace of the last minutes: the brake stops BEFORE the budget, not
    # one look after it (with Claude ~0.5 $ a minute, a look a minute late is half a dollar over).
    # after a resume the rate is the team's since then, restart included (the hard stop pays it): not a fifth of it spread over the pause
    hard_window = RATE_WINDOW_SEC
    since_resume = spent.get("since_resume")
    if since_resume is not None and since_resume < RATE_WINDOW_SEC:
        hard_window = max(CHECK_EVERY_SEC / 2.0, since_resume)
    ahead = (spent.get("recent_cost") or 0.0) / hard_window * CHECK_EVERY_SEC
    common = {"action": "halt", "spent": used, "usd": budget["usd"], "ends": budget["ends"], "starts": budget["starts"],
              "counts_from": budget["counts_from"]}
    stop = dict(common, why="budget", ceiling=budget["usd"], resumes=None)
    # the budget is reached when it is SPENT (to the margin). Reached only by the look ahead (a burst of a minute spread to the next
    # look: 2.54 of 3.0 in the retest 22b3c6eab) it is the pace's pause that comes next, with its hour: «scegli un nuovo budget»
    # with 0.46 $ left, and then «riprende alle 17:41» 37 s later, were two opposite words for one pause. The stop stays the
    # budget's only when the pace has no pause to give.
    over = used + ahead >= budget["usd"] - team_budget.margin(budget["usd"])
    if over and used >= budget["usd"] - team_budget.margin(budget["usd"]):
        return stop
    if budget["starts"] is None:
        return stop if over else None  # a budget of a duration that has not started: no period and no pace yet, only the dollars
    if now + CHECK_EVERY_SEC > budget["ends"]:  # the end falls before the next look: now, not a look late
        return dict(common, why="period", ceiling=budget["usd"], resumes=None)
    if not budget.get("pace"):
        return stop if over else None   # the pace is the person's to ask for: off, the budget and the end of the period are all that stop the team
    # The pace is the period's: what the onboarding spent before the first worker counts against the budget (above), not
    # against the pace, which spreads what was LEFT at the start over the period (giro Mac 21: 2 $ for a day on Claude, 1.71 $
    # of onboarding, and the pace paused the team the minute the Scouts started).
    before = min(spent.get("before_start") or 0.0, used)
    common["before"] = before
    period = dict(budget, usd=budget["usd"] - before)
    if period["usd"] <= 0:
        return stop if over else None
    allowance = team_budget.allowed(config, period, now)
    # what a restart needs under the line: the reload and the work after it. A budget or a period too small to ever give that room lowers
    # the multiple (never below the reload and as much work again) and, at the end, asks only for what is left: the hour told is a true
    # one, and the budget is not left locked with a message that says «until the end of the period»
    left = period["usd"] - (used - before) - (spent.get("reserve_open") or 0.0) - (team_budget.margin(period["usd"]) if PACE_SLACK else 0.0)
    # the lower multiples only for a period that could never give 3 times the reload (a small budget, the end of the period): in the middle
    # of a period that could, the team waits for the room (retest 22b3c6eab: lifted at 2 times, it worked 59 s)
    can_ever = period["usd"] - (team_budget.margin(period["usd"]) if PACE_SLACK else 0.0) >= restart_estimate * WORK_MULTIPLE
    multiple = WORK_MULTIPLE if left >= restart_estimate * WORK_MULTIPLE else (
        WORK_MULTIPLE if can_ever else (2.0 if left >= restart_estimate * 2.0 else 1.0))
    room = max(RESTART_RESERVE_SHARE * period["usd"], restart_estimate * multiple)
    if restart_estimate > 0 and left >= restart_estimate * 2.0 and not can_ever:
        room = min(room, left - 1e-6)
    reserve = room if held_by_pace else 0.0
    # the calls in flight when the brake looks finish and are paid (the pace let 0.16 $ through, giro Mac 12b): one margin before the line
    slack = team_budget.margin(period["usd"]) if PACE_SLACK else 0.0
    # the pace looks AHEAD like the budget does: a team that restarts spends in the first minute what the next look would only see
    # the restart is NOT out of what was spent any more (giro Linux, retest of the brake: 1.90 $ against a line of 1.04, the restart
    # left out was the whole overshoot): the lift and the stages keep its room under the line (`reserve_open`) and the rate leaves out
    # only its burst, which is already reserved
    opened = spent.get("reserve_open") or 0.0
    # right after a resume the last five minutes are mostly the pause: the work of the team is spread over all of them and the pace
    # looks at a fifth of what it will spend (giro Linux build13: 0.86 $ in 282 s, 0.45 $ over the pace). So the window of the rate
    # is the time the team has been working again, outside the restart, and never below half a look.
    window = RATE_WINDOW_SEC
    since = spent.get("since_resume")
    if since is not None and since < RATE_WINDOW_SEC + RESTART_WINDOW_SEC:
        window = max(CHECK_EVERY_SEC / 2.0, min(RATE_WINDOW_SEC, since - RESTART_WINDOW_SEC))
    ahead_pace = max(0.0, (spent.get("recent_cost") or 0.0) - (spent.get("restart_recent") or 0.0)) / window * CHECK_EVERY_SEC
    if used - before + opened + ahead_pace + reserve + slack >= allowance:
        lift = team_budget.resumes_at(config, period, used - before + opened + room + slack)
        if over and lift is None:
            return stop    # the look ahead says the budget ends and the pace has no hour to give: the budget's stop, as ever
        # no lift inside the period: the team stays paused until it ends (or the person raises the budget), and no hour is promised
        return dict(common, why="pace", ceiling=round(before + allowance, 6), resumes=lift or budget["ends"], stays=lift is None)
    return stop if over else None


def decide(config, spent, no_quota_mode, now=None, budget=None, held_by_pace=False, restart_estimate=0.0, stop_at=None):
    """{"action": "none" | "halt" | "warn", ...}. Pure: a config, a measure and a moment in, a verdict out. `budget` is
    the one team_budget.read gave with the start of a duration resolved; None reads it from the config alone."""
    # Before the mode: the bridge declares the no-quota mode at the END of its first tick, so a team that found the
    # credit already gone never got past here (collaudo Linux, 12/11), and a Codex team whose pi agents answer «no
    # credit» has quota data and would never pause either. Every call would fail: the team waits, whatever the mode.
    if spent.get("credit"):
        return {"action": "halt", "why": "credit", "provider": spent["credit"]["provider"], "spent": 0.0, "ceiling": 0.0}
    # The budget of the setup before the mode, as the credit: it is the person's own dollars, and the bridge declares the
    # no-quota mode only at the END of its first tick. A bridge started again (the container made again by the switch onto
    # the full image) read «no mode yet» as «nothing to stop» and lifted a pause of a spent budget (giro Windows 16/11:
    # «cleared» at 2.05 $ of 2, then 2.81 $).
    budget = budget if budget is not None else team_budget.read(config)
    # the stop the Captain committed to («I stop at 2.4 $»: W1 F-04, it was at 3.06 $ by then) is a ceiling the system applies,
    # on the figure the person reads, one margin before it and looking ahead like the budget
    if stop_at is not None:
        figure, _counts = counted(spent, budget)
        ahead = (spent.get("recent_cost") or 0.0) / RATE_WINDOW_SEC * CHECK_EVERY_SEC
        if figure + ahead >= stop_at["usd"] - team_budget.margin(stop_at["usd"]):
            return {"action": "halt", "why": "stop_at", "spent": figure, "ceiling": stop_at["usd"],
                    "set_at": stop_at.get("set_at")}
    if budget is not None and now is not None:
        verdict = _budget_verdict(config, budget, spent, now, held_by_pace, restart_estimate)
        if verdict:
            return verdict
    if not no_quota_mode:
        return {"action": "none"}  # with quota data the Sentinella paces by the windows and the daily cap
    eur, tokens = ceilings(config)
    if eur is None and tokens is None:
        return {"action": "none" if budget is not None else ("warn" if spent["calls"] else "none")}
    if eur is not None and spent["cost"] >= eur:
        return {"action": "halt", "why": "eur", "spent": spent["cost"], "ceiling": eur}
    if tokens is not None and spent["hour_tokens"] >= tokens:
        return {"action": "halt", "why": "tokens", "spent": spent["hour_tokens"], "ceiling": tokens}
    return {"action": "none"}


def _money(value):
    return ("%.2f" % value).rstrip("0").rstrip(".") if value < 100 else "%d" % value


def clock(moment, config, today=None):
    """HH:MM (zone name) in the person's zone; with the date in front when it is not today."""
    local = datetime.fromtimestamp(moment, team_budget.timezone_of(config))
    day = datetime.fromtimestamp(today, team_budget.timezone_of(config)).date() if today is not None else local.date()
    when = local.strftime("%H:%M") if local.date() == day else local.strftime("%Y-%m-%d %H:%M")
    zone = team_budget.timezone_of(config)
    return "%s (%s)" % (when, getattr(zone, "key", None) or local.tzname() or "UTC") if zone is not None else when


def person_clock(moment, config, today, i18n):
    """The hour as the person reads it: «03:50» today, «03:50 tomorrow» the day after, the date only further away. No zone name:
    it is their own."""
    zone = team_budget.timezone_of(config)
    local = datetime.fromtimestamp(moment, zone)
    day = datetime.fromtimestamp(today, zone).date() if today is not None else local.date()
    hour = local.strftime("%H:%M")
    days = (local.date() - day).days
    if days == 0:
        return hour
    if days == 1:
        return i18n.tf("pi_cap.tomorrow", hour)
    return local.strftime("%Y-%m-%d ") + hour


def user_text(verdict, spent, config=None, now=None):
    i18n = quota_data.shared_i18n()  # shared/i18n.py, found from the skills folder too
    clock = lambda moment, cfg, today: person_clock(moment, cfg, today, i18n)  # noqa: E731 - here the hour is the person's, not the Captain's

    if verdict["action"] == "warn":
        return i18n.t("pi_cap.no_ceiling")
    if verdict["why"] == "credit":
        return i18n.tf("pi_cap.halt_credit", PROVIDER_NAMES.get(verdict["provider"], verdict["provider"] or "the provider"))
    if verdict["why"] == "budget":
        return i18n.tf("pi_cap.halt_budget", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["usd"]))
    if verdict["why"] == "period":
        return i18n.tf("pi_cap.halt_period", clock(verdict["ends"], config, now), "%s USD" % _money(verdict["spent"]),
                       "%s USD" % _money(verdict["usd"]))
    if verdict["why"] == "pace" and verdict.get("stays"):
        return i18n.tf("pi_cap.halt_pace_stays", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["usd"]),
                       clock(verdict["ends"], config, now))
    if verdict["why"] == "pace":
        return i18n.tf("pi_cap.halt_pace", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["usd"]),
                       clock(verdict["resumes"], config, now))
    if verdict["why"] == "stop_at":
        return i18n.tf("pi_cap.halt_stop_at", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["ceiling"]))
    if verdict["why"] == "eur":
        return i18n.tf("pi_cap.halt_eur", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["ceiling"]))
    return i18n.tf("pi_cap.halt_tokens", "%d" % verdict["spent"], "%d" % verdict["ceiling"])


def first_burst_progress(home):
    """(scored so far in the first burst, its target) while the burst is open and short of its target, else None.
    Read from the burst's own state file and the scores table, writing nothing; any reading that fails is None."""
    try:
        state = json.loads((Path(home) / "state" / "first-run.json").read_text(encoding="utf-8"))
        target = state.get("target_scored")
        if state.get("phase") != "burst" or isinstance(target, bool) or not isinstance(target, int) or target <= 0:
            return None
        conn = sqlite3.connect("file:%s?mode=ro" % (Path(home) / "jobs.db"), uri=True, timeout=5)
        try:
            scored = int(conn.execute("SELECT COUNT(DISTINCT position_id) FROM scores").fetchone()[0])
        finally:
            conn.close()
        produced = scored - int(state.get("scored_at_start") or 0)
        return (max(produced, 0), target) if produced < target else None
    except Exception:  # noqa: BLE001 - no reading, no sentence: the alert goes without it
        return None


def _budget_captain_text(verdict, config, now):
    if verdict["why"] == "budget":
        head, what, lift = ("BUDGET SPENT", "%s USD spent of the %s USD the person declared for the period"
                            % (_money(verdict["spent"]), _money(verdict["usd"])),
                            "It does NOT lift by itself: it lifts when the person sets a new budget (jht setup).")
    elif verdict["why"] == "period":
        head, what, lift = ("BUDGET PERIOD OVER", "the period the person declared ended at %s (%s USD spent of %s USD)"
                            % (clock(verdict["ends"], config, now), _money(verdict["spent"]), _money(verdict["usd"])),
                            "It does NOT lift by itself: it lifts when the person sets a new period (jht setup).")
    else:
        head = "BUDGET PACE"
        what = ("%s USD spent of %s USD, ahead of the pace (the share of the budget of the worked time gone by, one working "
                "hour ahead, allows %s USD by now)" % (_money(verdict["spent"]), _money(verdict["usd"]),
                                                        _money(verdict["ceiling"])))
        lift = ("It lifts by itself at %s, when the worked time catches up." % clock(verdict["resumes"], config, now))
        if verdict.get("stays"):
            lift = ("It does NOT lift by itself before the period ends (%s): what is left of the budget does not cover the reload of the "
                    "contexts of the sessions. It lifts when the person raises the budget (jht setup)." % clock(verdict["ends"], config, now))
    return head, what, lift


def captain_text(verdict, spent, burst=None, config=None, now=None):
    if verdict["action"] == "warn":
        return ("[BRIDGE INFO] pi spent %s USD today (its own estimate) and no spending ceiling is declared "
                "(no budget, no no_quota_cap in the configuration): this access has no quota data, so nothing else stops the "
                "spending. INTERNAL: the person has been asked once by the system whether to set a budget (jht setup); do not "
                "pass this on to them, and never in these words." % _money(spent["cost"]))
    if verdict["why"] == "credit":
        return ("[BRIDGE ALERT] PROVIDER CREDIT GONE (pi harness): %s answered that the credit of the account is exhausted. "
                "The team is PAUSED: ESC to every session, no forced kill. This is a declared pause, not an outage and not "
                "FATAL. It lifts by itself when a call goes through again (the person tops up the account with the provider). "
                "The person is told by the system in one sentence: do not repeat it to them." % PROVIDER_NAMES.get(verdict["provider"], verdict["provider"]))
    if verdict["why"] == "stop_at":
        return ("[BRIDGE ALERT] YOUR SPENDING STOP REACHED: %s USD spent, the stop you committed to is %s USD. The team is PAUSED: "
                "no new model call starts (the gate of the agents holds it). It lifts when you raise or clear the stop "
                "(python3 /app/shared/skills/pi_spend_cap.py stop-at <usd> | --clear), and only on the person's word. The person "
                "is told by the system: do not repeat it to them." % (_money(verdict["spent"]), _money(verdict["ceiling"])))
    if verdict["why"] in ("budget", "period", "pace"):
        head, what, lift = _budget_captain_text(verdict, config, now)
        raise_it = "a new budget (jht setup)"
    else:
        head = "SPENDING CEILING REACHED"
        what = ("%s USD today against a ceiling of %s EUR" % (_money(verdict["spent"]), _money(verdict["ceiling"]))
                if verdict["why"] == "eur" else
                "%d tokens in the last hour against a ceiling of %d per hour" % (verdict["spent"], verdict["ceiling"]))
        lift = "It lifts by itself when the spending is back under the ceiling, or if the person raises it."
        raise_it = "raising the ceiling (no_quota_cap in the configuration)"
    return ("[BRIDGE ALERT] %s (pi harness): %s. The team is PAUSED: ESC to every session, no forced kill. This is a "
            "declared pause, not an outage and not FATAL. %s The person is told by the system in one sentence: do not repeat it to them.%s" % (head, what, lift, (
                " The FIRST BURST is open and stops on this ceiling at %d of %d scored positions: say so in the chat, in "
                "their language: how many scored positions they have, and that %s lets the burst go on to %d."
                % (burst[0], burst[1], raise_it, burst[1])) if burst else ""))


def _flag(api):
    try:
        payload = _read_state(api._path("DAILY_HALT_FLAG"), FLAG_MAX_BYTES)
    except Exception:  # noqa: BLE001
        return None
    return payload if isinstance(payload, dict) else None


def _flag_reason(api):
    payload = _flag(api)
    return payload.get("reason") if payload else None


ASSISTENTE_SESSION = "ASSISTENTE"


def assistant_text(text):
    """What the Assistente reads of a pause or a resume: the state, for when the person asks, never a message to pass on (the person
    has the notifier's sentence already). Without it the Assistente read the tmux sessions and said «the team is active» to a person
    whose team had been paused by its budget for seven minutes (collaudo L1 bis 26/11)."""
    return ("[BRIDGE INFO] FOR YOUR KNOWLEDGE, NOT TO RELAY: the state of the team changed. %s The person has already been told by "
            "the system in one sentence: do not repeat it unasked. When they ask how the team is, the source is `jht team status` "
            "(python3 /app/shared/skills/standby.py status in the container), never the tmux sessions." % text)


def _tell(api, run, key, text, user, notify_user, assistant=False):
    """The Captain and the Sentinella through the delivery notice, the person through the notifier, and with `assistant` the
    Assistente too (its own text: the state, not an alarm to relay). Each goes once per `key`: what did not go (a session absent, a
    notifier down) is tried again on the next tick, what went is not repeated."""
    from sentinel_delivery import notice

    done = run.state.setdefault("pi_spend_cap", {})
    to = [(api.CAPITANO_SESSION, text), (api.SENTINELLA_SESSION, text)]
    if assistant:
        to.append((getattr(api, "ASSISTENTE_SESSION", ASSISTENTE_SESSION), assistant_text(text)))
    for session, words in to:
        if not done.get("%s:%s" % (key, session)):
            done["%s:%s" % (key, session)] = bool(notice(api, run.state, "pi_cap:%s:%s" % (key, session), session, words))
    if user is not None and not done.get(key):
        try:
            # one source id per notice: the tool refuses a second notice under the same id with another text (exit 2), so only
            # the first pause of a team was ever told to the person (giro Windows 16/11: «jht-notify-user failed with exit 2»)
            notify_user(user, "%s-%s" % (REASON, re.sub(r"[^A-Za-z0-9_.-]+", "-", key)))
            done[key] = True
        except Exception as error:  # noqa: BLE001 - not a reason to stop the tick
            print("[bridge V6] WARN pi spend cap user notice: %s" % error)


def _iso(moment, config):
    if moment is None:
        return None
    zone = team_budget.timezone_of(config)
    local = datetime.fromtimestamp(moment, zone) if zone is not None else datetime.fromtimestamp(moment).astimezone()
    return local.isoformat(timespec="seconds")


def _record(verdict, config):
    """What the flag says of the pause, for `jht team status`, `jht team start` and `jht doctor`."""
    record = {"why": verdict["why"], "spent": verdict["spent"], "ceiling": verdict["ceiling"]}
    if verdict["why"] == "stop_at":
        record["set_at"] = verdict.get("set_at")
    if verdict["why"] in ("budget", "period", "pace"):
        record.update(budget_usd=verdict["usd"], starts_at=_iso(verdict["starts"], config),
                      ends_at=_iso(verdict["ends"], config),
                      resumes_at=None if verdict.get("stays") else _iso(verdict["resumes"], config),
                      counts_from=int(verdict["counts_from"]))
        if verdict.get("stays"):
            record["stays"] = True
        if verdict.get("before"):
            record["before_work"] = {"spent": verdict["before"], "budget_usd": verdict["usd"]}
    return record


def _halt_key(verdict, day, home=None):
    """One notice per pause. The stop of the budget or of the period is the same for the whole budget, but the team that was woken
    in between and stops again is a new pause for the person (retest 22b3c6eab: the last stop, at 2.84 of 3.0 after a resume,
    came with no word: the key was the one already told)."""
    try:
        woken = max(_read_resumes(home) or [0.0]) if home is not None else 0.0
    except Exception:  # noqa: BLE001
        woken = 0.0
    again = ":%d" % int(woken // 60) if woken > verdict.get("counts_from", 0) else ""
    if verdict["why"] == "budget":
        return "halt:budget:%d%s" % (int(verdict["counts_from"]), again)
    if verdict["why"] == "period":
        return "halt:period:%d%s" % (int(verdict["ends"]), again)
    if verdict["why"] == "pace":
        return "halt:pace:%d" % int(verdict["resumes"] // 60)
    if verdict["why"] == "stop_at":
        return "halt:stop_at:%s:%s" % (_money(verdict["ceiling"]), verdict.get("set_at") or day)
    return "halt:%s:%s" % (day, verdict["why"])


def _halt(api, run, verdict, spent, day, notify_user, config=None, now=None, escape=True):
    """The gate first, then the ESC, then the words. The gate of the agents (spend-gate.js) reads the flag with this reason:
    written after the notices to the Captain and the Sentinella, which wait for the sessions, it came 23 s after the
    «reached» line, and the Captain made four more calls in between (giro Windows 16/11: 0.16 $). A Captain held by the gate
    does not read its notice; the person is told by the notifier, and the Captain by the notice of the resume."""
    record = _record(verdict, config)
    if pending_wakes(api._path("JHT_HOME")):
        set_pending(api._path("JHT_HOME"), [], api.time.time())   # everyone is stopped again: the next lift stages from the start
    if escape:
        api._activate_daily_halt(100.0 * verdict["spent"] / verdict["ceiling"] if verdict["ceiling"] else 100.0, 100.0,
                                 100.0, extra={"reason": REASON, "pi_spend_cap": record})
    try:
        payload = _read_state(api._path("DAILY_HALT_FLAG"), FLAG_MAX_BYTES)
        payload["reason"] = REASON
        payload["pi_spend_cap"] = record
        api._write_daily_halt_payload(payload)
    except Exception:  # noqa: BLE001 - a flag that cannot be read stays as the gate wrote it
        pass
    print("[bridge V6] %s PI-SPEND-CEILING reached (%s: %s of %s): team paused"
          % (run.now_h, verdict["why"], verdict["spent"], verdict["ceiling"]))
    burst = first_burst_progress(api._path("JHT_HOME"))
    _tell(api, run, _halt_key(verdict, day, api._path("JHT_HOME")), captain_text(verdict, spent, burst, config, now),
          user_text(verdict, spent, config, now), notify_user, assistant=True)


# A resume time that moves (spending after the pause: a turn already running, a welcome at `jht up`) is written in the flag
# at once, for `jht team status` and the chat; the person is told again when it moved by this much or the time they were told
# is already gone (giro Windows 16/11: «resumes at 14:58», still paused at 16:11, the brake reckoning 16:53).
RESUME_MOVED_SEC = 300


def _resume_moved(api, run, verdict, spent, day, notify_user, config, now, flag):
    """The flag says the resume time the brake reckons now; the person is told again when it moved RESUME_MOVED_SEC from the
    time they were told (`resumes_told_at`: small moves add up), or that time is gone. Never a second ESC."""
    record = flag.get("pi_spend_cap") or {}

    def moment(text):
        try:
            return datetime.fromisoformat(text).timestamp() if text else None
        except (TypeError, ValueError):
            return None

    new = verdict.get("resumes")
    if new is None:
        return
    if verdict.get("stays") and record.get("stays"):
        return  # said once: no hour to move
    written = moment(record.get("resumes_at"))
    told = moment(record.get("resumes_told_at") or record.get("resumes_at"))
    # one message per pause: a time that moves is written in the flag, and told again only when the time the person was given is gone
    # or is no longer a time at all (the pause now lasts to the end of the period)
    tell = told is None or (told <= now and int(told // 60) != int(new // 60)) or bool(verdict.get("stays") and not record.get("stays"))
    if written is not None and int(written // 60) == int(new // 60) and not tell:
        return
    fresh = _record(verdict, config)
    fresh["resumes_told_at"] = fresh["resumes_at"] if tell else record.get("resumes_told_at") or record.get("resumes_at")
    flag["pi_spend_cap"] = fresh
    api._write_daily_halt_payload(flag)
    if tell:
        print("[bridge V6] %s PI-SPEND-CEILING pause moved: resumes %s (was %s)"
              % (run.now_h, fresh["resumes_at"], record.get("resumes_at")))
        _tell(api, run, _halt_key(verdict, day), captain_text(verdict, spent, None, config, now),
              user_text(verdict, spent, config, now), notify_user, assistant=True)


def _held_by_the_budget(flag, budget):
    """True when the flag is the pause of a spent budget or an ended period of THIS budget: it does not lift by itself, only a new
    budget (jht setup) lifts it. The verdict that raised it can stop being one with no new budget at all: the stop looks AHEAD
    at the pace of the last minutes, and a team that has stopped has no pace, so the next look finds 4.77 $ of 5 under the line
    and would clear it, the team would work again and stop a second time at 4.93 $ (giro Windows 16/11: 13:00 stop, 13:02 «cleared»,
    14 more calls). The budget is the same when the flag names the moment its dollars count from (`counts_from`); a flag written
    before that field is the same when it names the same dollars and the same start."""
    record = (flag or {}).get("pi_spend_cap") or {}
    if record.get("why") not in ("budget", "period") or budget is None:
        return False
    if record.get("counts_from") is not None:
        return int(record["counts_from"]) == int(budget["counts_from"])
    try:
        started = datetime.fromisoformat(record["starts_at"]).timestamp() if record.get("starts_at") else None
    except (TypeError, ValueError):
        return False
    return (started is not None and budget.get("starts") is not None and int(started) == int(budget["starts"])
            and record.get("budget_usd") == budget["usd"])


def _wake_the_team(api, sessions, why, seen=(), stage=None, queue_at=None):
    """[RIPRENDI] to every session the pause stopped, the moment the pause is lifted: they were ESC'd, and left to wait for the
    Sentinella's next cycle they stayed silent for a quarter of an hour (a VPS round: «allows work again» 18:31, the Scouts back at
    18:46). The Captain and the Sentinella have their own notice; a team the person stopped, a standby, and an agent the person
    paused alone are not woken here. Best effort: a session that does not answer is left to that next cycle, as before.

    A session BORN during the pause is not in the list the ESC wrote: its first message was held by the gate (`input` handled,
    nothing sent to the model, never delivered again), so it sat with nothing to do while the budget was back (an Analyst started
    by an update during the pause: 14 minutes, 0 calls, 13 positions waiting). The live agent sessions are asked too (`seen`: the
    sessions the bridge saw talking during the pause, and what tmux lists now), and those that were not in the list get a text
    that says their first message never reached them."""
    home = api._path("JHT_HOME")
    try:
        if (Path(home) / ".team-halted.flag").exists() or (Path(home) / ".team-standby.flag").exists():
            return []
        alone = set()
        try:
            import agent_pause
            alone = set(agent_pause.paused_sessions(home=home))
        except Exception:  # noqa: BLE001 - without the list nobody is held back by it
            pass
        text = ("[RIPRENDI] The pause is over (%s). Your session and context were never closed: pick up EXACTLY where you were, "
                "with the step you had in hand, and do not start over." % why)
        newcomer_text = ("[RIPRENDI] The pause is over (%s). The message that started you arrived DURING the pause and was held back: "
                         "it never reached you. If you have not started your work yet, start it now from your role instructions; "
                         "if you were in the middle of a step, pick up exactly there." % why)
        known = list(sessions or [])
        live = []
        try:
            lister = getattr(api, "list_tmux_sessions", None)
            live = [s for s in (lister() if lister else []) if _AGENT_SESSION.match(s or "")]
        except Exception:  # noqa: BLE001 - without the list only the sessions the ESC reached are woken, as before
            live = []
        extra = [s for s in list(seen or ()) + live if s not in known and _WORKER_SESSION.match(s or "")]
        woken = []
        order = known + list(dict.fromkeys(extra))
        if stage is not None:
            order = sorted(order, key=_wake_rank)   # the Scouts first: the ones the line holds are the last of the list
        chosen = []
        for session in order:
            if session in (api.CAPITANO_SESSION, api.SENTINELLA_SESSION) or session in alone or session in NEVER_WAKE:
                continue
            if session in WAKE_ONLY_IF_NEEDED and not (session == "ASSISTENTE" and _assistant_owes_an_answer(home)):
                continue
            try:
                # a worker retired during the pause (the RAM guard, the Captain) has no window: nothing to wake, and the send
                # would only log rc=2 (giro Linux build13: three WARN at every resume)
                exists = getattr(api, "session_exists", None)
                if exists is not None and not exists(session):
                    continue
                if stage is not None and not stage.take(session):
                    continue   # the line does not hold its reload yet: it waits in the queue and the next look wakes it
                chosen.append(session)
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN pi spend cap wake of %s: %s" % (session, error))
        if stage is not None and queue_at is not None:
            # the queue is written BEFORE the first send: the gate of the session holds every message for a name in it, and the
            # [RIPRENDI] of the stage must be the one that gets through (the names it wakes are already out)
            set_pending(home, stage.pending, queue_at)
        for session in chosen:
            try:
                if api.jht_tmux_send(session, text if session in known else newcomer_text):
                    woken.append(session)
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN pi spend cap wake of %s: %s" % (session, error))
        return woken
    except Exception as error:  # noqa: BLE001 - a wake that fails must not stop the tick
        print("[bridge V6] WARN pi spend cap wake: %s" % error)
        return []


NEVER_WAKE = {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}
# Idle at a resume: waking them rewrites their cache for nothing (0.15 $ the Assistente and 0.04 $ the Mentor, Linux 12b). The next
# message wakes them, and the Assistente is woken when the person's last message in its chat has no answer.
WAKE_ONLY_IF_NEEDED = {"ASSISTENTE", "MENTOR"}


def _assistant_owes_an_answer(home):
    """True when the last turn in the Assistente's chat is the person's: it was stopped half way through an answer."""
    last = None
    try:
        path = Path(home) / "agents" / "assistente" / "chat.jsonl"
        size = path.stat().st_size
        with open(path, "rb") as handle:
            handle.seek(max(0, size - 65536))
            for raw in handle:
                try:
                    row = json.loads(raw.decode("utf-8"))
                except ValueError:
                    continue
                if isinstance(row, dict) and row.get("role"):
                    last = row.get("role")
    except OSError:
        return True     # not readable: waking it costs 0.15 $, a person left without an answer costs more
    return last == "user"
_AGENT_SESSION = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$")   # the sessions of the team: CAPITANO, SCOUT-1, ANALISTA-5
# Born during the pause and not woken by the ESC list: only the workers (the fixed agents were there when it started)
_WORKER_SESSION = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CRITICO|CLOSER)(-S?\d+)?$")


def _stopped_by_the_person(home) -> bool:
    try:
        return (Path(home) / ".team-halted.flag").exists()
    except OSError:
        return False


def home_of(api):
    return api._path("JHT_HOME")


def _resume(api, run, day, notify_user, ctx=None):
    i18n = quota_data.shared_i18n()

    flag = _flag(api) or {}
    was = (flag.get("pi_spend_cap") or {}).get("why")
    try:
        api._path("DAILY_HALT_FLAG").unlink()
    except OSError:
        return
    if was == "pace" and ctx is None:
        note_resume(home_of(api), api.time.time())
    if was in ("budget", "period", "pace"):
        text = "[BRIDGE INFO] The budget the person declared allows work again: the team can resume; ticks are restarting."
        user = i18n.t("pi_cap.resume_budget")
    elif was == "stop_at":
        text = "[BRIDGE INFO] The spending stop was raised or cleared: the team can resume; ticks are restarting."
        user = i18n.t("pi_cap.resume")
    else:
        text = "[BRIDGE INFO] The pi spending ceiling allows work again: the team can resume; ticks are restarting."
        user = i18n.t("pi_cap.resume")
    if _stopped_by_the_person(home_of(api)):
        # the person stopped the team (collaudo Linux 23/11: «the team restarts» right after a stop of every agent): nobody is woken
        # (_wake_the_team), and the person is told the truth, with the way to start it again
        user = i18n.t("pi_cap.resume_team_stopped")
    # the gate is open (the flag is gone) BEFORE anyone is told to work: the order of the standby too
    stage, names = None, list(flag.get("sessions") or [])
    home, moment = home_of(api), api.time.time()
    if ctx is not None and was in ("budget", "period", "pace") and ctx.get("budget") is not None:
        # by stages, the same for the lift of the pace and the unblock of a new budget (giro Linux, retest of the brake: seven Sonnet
        # sessions woken together spent 1.90 $ against a line of 1.04): the ones whose reload fits under the line, the Scouts first
        live = []
        try:
            lister = getattr(api, "list_tmux_sessions", None)
            live = [x for x in (lister() if lister else []) if _AGENT_SESSION.match(x or "")]
        except Exception:  # noqa: BLE001
            live = []
        costs = session_costs(home, moment, names + [x for x in live if x not in names])
        stage = Stage(_stage_room(ctx["config"], ctx["budget"], ctx["spent"], moment), costs)
        for fixed in ALWAYS_WOKEN:
            if fixed in costs:
                stage.reserve(fixed)
    woken = _wake_the_team(api, flag.get("sessions"), "the budget allows work again" if was in ("budget", "period", "pace") else "spending is back under the ceiling",
                        seen=list((flag.get("pane_signatures") or {}).keys()), stage=stage, queue_at=moment)
    if stage is not None:
        note_wake(home, moment, stage.estimate, stage.woken)
        set_pending(home, stage.pending, moment)
        _tell_the_captain_the_queue(api, run, "stage:%s:%d" % (day, int(moment)), woken, stage.pending)
    _tell(api, run, "resume:%s:%d" % (day, int(api.time.time())), text, user, notify_user, assistant=True)
    print("[bridge V6] %s PI-SPEND-CEILING cleared: spending back under the ceiling%s" % (run.now_h, " · [RIPRENDI] to %s" % ", ".join(woken) if woken else ""))


def _tell_the_captain_the_queue(api, run, key, woken, pending):
    """The Captain is told which workers wait for the pace and that it is not for him to wake them: the line of the budget does not
    hold their reload yet, and a worker started by hand is stopped by the pace like any other."""
    if not pending:
        return
    try:
        from sentinel_delivery import notice
        text = ("[BRIDGE INFO] THE PACE WAKES THE TEAM BY STAGES: the budget line holds the reload of part of the sessions now, not of all "
                "of them. Woken: %s. Waiting for the pace: %s. Do NOT wake them yourself (no message to them, no scale-up to replace "
                "them): the brake wakes each one as the line rises, the Scouts first. A worker that starts anyway is stopped by the "
                "pace like any other." % (", ".join(woken) or "none yet", ", ".join(pending)))
        done = run.state.setdefault("pi_spend_cap", {})
        if not done.get(key):
            done[key] = bool(notice(api, run.state, "pi_cap:%s" % key, api.CAPITANO_SESSION, text))
    except Exception as error:  # noqa: BLE001 - a notice that fails must not stop the tick
        print("[bridge V6] WARN pi spend cap stage notice: %s" % error)


PENDING_TEXT = "[RIPRENDI] The pace allows your work again: pick up EXACTLY where you were, with the step you had in hand, and do not start over."


def _wake_pending(api, run, ctx):
    """The sessions the pace has not woken yet: each look wakes the ones whose reload fits under the line now. Best effort."""
    home = home_of(api)
    pending = pending_wakes(home)
    if not pending:
        return []
    try:
        exists = getattr(api, "session_exists", None)
        alive = [x for x in pending if exists is None or exists(x)]
        if not alive:
            set_pending(home, [], ctx["now"])
            return []
        stage = Stage(_stage_room(ctx["config"], ctx["budget"], ctx["spent"], ctx["now"]), session_costs(home, ctx["now"], alive))
        chosen = [x for x in sorted(alive, key=_wake_rank) if stage.take(x)]
        set_pending(home, stage.pending, ctx["now"])   # before the sends: the names it wakes are out of the queue the gate reads
        woken = []
        for session in chosen:
            try:
                if api.jht_tmux_send(session, PENDING_TEXT):
                    woken.append(session)
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN pi spend cap wake of %s: %s" % (session, error))
        if woken:
            note_wake(home, ctx["now"], stage.estimate, {n: stage.costs.get(n, RESTART_COST_PER_SESSION) for n in woken})
            print("[bridge V6] %s PI-SPEND-CEILING stage: [RIPRENDI] to %s, waiting for the pace: %s"
                  % (run.now_h, ", ".join(woken), ", ".join(stage.pending) or "none"))
        return woken
    except Exception as error:  # noqa: BLE001 - a stage that fails must not stop the tick
        print("[bridge V6] WARN pi spend cap stage: %s" % error)
        return []


def stage_fit(home, now, sessions):
    """The sessions of `sessions` that the pace has room for now, in the order of the wake (the Scouts first, nobody overtaking), for a start
    of the team that is not a lift of the pace (the restore of the roster after a restart of the container, retest 8d5f09a2b: «the team was
    restarted» to seven workers at once). None when no budget line applies: nothing to hold them for. A line that cannot be read holds all
    but nobody is lost: the watchdog brings them back one by one. {"taken": [...], "waiting": [...], "estimate": x, "costs": {...}}."""
    names = [x for x in (sessions or []) if isinstance(x, str)]
    try:
        config = _read_state(Path(home) / "jht.config.json", FLAG_MAX_BYTES)
        budget = team_budget.read(config, home) if isinstance(config, dict) else None
    except Exception:  # noqa: BLE001
        return {"taken": [], "waiting": names, "estimate": 0.0, "costs": {}}
    if budget is None or not budget.get("pace"):
        return None
    try:
        spent = spend(home, now, budget["counts_from"], budget["starts"])
        stage = Stage(_stage_room(config, budget, spent, now), session_costs(home, now, names))
        taken = [x for x in sorted(names, key=_wake_rank) if stage.take(x)]
        return {"taken": taken, "waiting": list(stage.pending), "estimate": stage.estimate, "costs": dict(stage.woken)}
    except Exception:  # noqa: BLE001 - a line that cannot be read holds the restore, never the hard cap
        return {"taken": [], "waiting": names, "estimate": 0.0, "costs": {}}


def _start(home, budget, moment, run, api=None, spent_before=0.0):
    """The team started working: the period of a budget of a duration starts at that first call, and is written down so
    the next tick, `jht team status` and a restarted bridge find it. A write that fails is a warning: this tick still
    counts from it, the next one tries again. When the onboarding spent more than half the budget the Captain is told, to
    say it to the person: they gave the money for the search."""
    if api is not None and spent_before > budget["usd"] / 2:
        _tell_onboarding(api, run, budget, spent_before)
    try:
        starts, ends = team_budget.record_start(home, budget, moment, spent_before)
    except OSError as error:
        print("[bridge V6] WARN pi spend cap: the start of the budget is not written: %s" % error)
        starts, ends = moment, moment + budget["duration"]
    print("[bridge V6] %s BUDGET started by the first work of the team: %s to %s"
          % (run.now_h, datetime.fromtimestamp(starts).isoformat(timespec="seconds"),
             datetime.fromtimestamp(ends).isoformat(timespec="seconds")))
    return dict(budget, starts=starts, ends=ends)


def _tell_onboarding(api, run, budget, spent_before):
    from sentinel_delivery import notice

    left = max(budget["usd"] - spent_before, 0.0)
    text = ("[BRIDGE INFO] MOST OF THE BUDGET WENT TO THE ONBOARDING: %s USD of the %s USD budget were spent before the first "
            "Scout worked, %s USD are left for the search, spread over the period. Not a fault. Tell the person once, in their "
            "language, in plain words: how much the setup and the first talk cost, how much is left for the search, and that a "
            "larger budget (jht setup) gives the search more." % (_money(spent_before), _money(budget["usd"]), _money(left)))
    done = run.state.setdefault("pi_spend_cap", {})
    key = "onboarding:%s" % budget.get("saved_at")
    if not done.get(key):
        done[key] = bool(notice(api, run.state, "pi_cap:%s" % key, api.CAPITANO_SESSION, text))


def _tell_budget_changed(api, run, budget, config, now):
    """The person saved another budget (jht setup) while the team was running: the Capitano is told the new figures once. Its memory
    still holds the old ones and it decided on them (retest 25395266b: «Scout: per ora nessuno, il tetto è 3 USD» with 2 USD set an
    hour before). The first budget the bridge sees is not a change."""
    from sentinel_delivery import notice

    done = run.state.setdefault("pi_spend_cap", {})
    saved = budget.get("saved_at") or "%s:%s:%s" % (budget["usd"], budget.get("starts"), budget.get("ends"))   # a fixed period has no stamp
    seen = done.get("budget_seen")
    if seen == saved:
        return
    done["budget_seen"] = saved
    if seen is None:
        return
    period = ("from %s to %s" % (clock(budget["starts"], config, now), clock(budget["ends"], config, now))
              if budget.get("starts") is not None else
              ("for %g minutes from the first work of the team" % (budget["duration"] / 60) if budget.get("duration") else "open"))
    text = ("[BRIDGE INFO] THE BUDGET CHANGED: the person saved a new one. It is now %s USD %s%s. Every figure of the old budget you "
            "remember or wrote in your diary is void: decide the roster and the throttle on this one (read it again with "
            "`jht team status`, never from memory)."
            % (_money(budget["usd"]), period, ", with the pace on" if budget.get("pace") else ""))
    if not notice(api, run.state, "pi_cap:budget_changed:%s" % saved, api.CAPITANO_SESSION, text):
        done["budget_seen"] = seen    # not delivered: the next tick tries again
        return
    # the Assistente answers the person about the budget from what it remembers (retest 25395266b: «il budget dichiarato è di 3 dollari»
    # two hours after the person set 2): it hears the new figures too, once, and answers from them. A session that is not there reads
    # the budget fresh when it starts: nothing to retry.
    notice(api, run.state, "pi_cap:budget_changed_assistant:%s" % saved, "ASSISTENTE",
           "[BRIDGE INFO] THE BUDGET CHANGED: the person saved a new one: %s USD %s%s. Every other figure you remember is void: when the "
           "person asks about the budget, answer from this one (or from `jht team status`), not from memory. Do not answer this message."
           % (_money(budget["usd"]), period, ", with the pace on" if budget.get("pace") else ""))


def step(api, run, notify_user=None):
    """One tick of the brake. Never raises."""
    try:
        notify_user = notify_user or quota_data._notify_user  # resolved at call time, so a test can replace it
        now = api.time.time()
        home = api._path("JHT_HOME")
        config = api._read_config_json()
        budget = team_budget.read(config, home)
        if budget is not None:
            try:    # a notice that fails is a notice lost, never a look of the brake lost
                _tell_budget_changed(api, run, budget, config, now)
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN pi spend cap budget notice: %s" % error)
        spent = spend(home, now, budget["counts_from"] if budget else None, budget["starts"] if budget else None)
        if budget is not None and budget["starts"] is None and spent["first_worker"] is not None:
            budget = _start(home, budget, spent["first_worker"], run, api, spent.get("before_start") or 0.0)
        day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
        stop = read_stop_at(home)
        try:    # the figure and the rate of the status, the chat and the Captain's projections: never a reason to miss a look
            write_spend_now(home, now, spent, budget, measured(home, now), stop)
        except Exception as error:  # noqa: BLE001
            print("[bridge V6] WARN pi spend cap spend-now: %s" % error)
        flag = _flag(api)
        mine = bool(flag) and flag.get("reason") == REASON
        held_by_pace = mine and (flag.get("pi_spend_cap") or {}).get("why") == "pace" and api._daily_halt_active()
        estimate = first_stage_cost(home, now, (flag or {}).get("sessions")) if held_by_pace else 0.0
        ctx = {"config": config, "budget": budget, "spent": spent, "now": now}
        verdict = decide(config, spent, bool(run.state.get("no_quota_declared")), now, budget, held_by_pace, estimate, stop)
        if held_by_pace or (verdict["action"] == "halt" and verdict.get("why") == "pace"):
            # the hour told at the first pause is the hour the lift will find, and the hour of a later look is the same: both reckon the reload
            # of the sessions of the team (the flag's, the ones that spent in the last day, the live ones) and the work after it. The hour moved
            # after every pause when the first one reckoned the tenth of the budget (retest 8d5f09a2b)
            estimate = first_stage_cost(home, now, _team_sessions(api, home, now, flag))
            verdict = decide(config, spent, bool(run.state.get("no_quota_declared")), now, budget, held_by_pace, estimate, stop)
        if verdict["action"] == "halt":
            if run._bi_on:
                print("[bridge V6] %s BURN-INTENT: pi spending ceiling reached, the team stays active (user override)"
                      % run.now_h)
                if mine:  # the gate of the agents (spend-gate.js) reads this flag: the person's override opens it
                    _resume(api, run, day, notify_user)   # no stages: the person asked for it
            elif not api._daily_halt_active():
                _halt(api, run, verdict, spent, day, notify_user, config, now)
            elif mine and (flag.get("pi_spend_cap") or {}).get("why") != verdict["why"]:
                # Already paused by this brake for another reason (the pace, and now the budget or the period is over):
                # the person and the Captain are told the new one, the flag says it; no second ESC.
                _halt(api, run, verdict, spent, day, notify_user, config, now, escape=False)
            elif mine and verdict["why"] == "pace":
                _resume_moved(api, run, verdict, spent, day, notify_user, config, now, flag)
        elif mine and (budget is not None or run.state.get("no_quota_declared")
                       or (flag.get("pi_spend_cap") or {}).get("why") == "stop_at") and not _held_by_the_budget(flag, budget):
            # Lifted only by a tick that looked: without a budget and before the no-quota mode is declared (the first tick
            # of a bridge started again) the ceilings were not read, and «nothing to stop» is not «back under».
            _resume(api, run, day, notify_user, ctx)
        elif verdict["action"] != "halt" and not api._daily_halt_active():
            _wake_pending(api, run, ctx)
        if verdict["action"] == "warn":
            # the person once, not once a day: a sentence that asks them to decide, with no figure that goes stale in the chat
            # (W1 F-09); the figure of the day is in `jht team status`, written at every look (state/spend-now.json)
            done = run.state.setdefault("pi_spend_cap", {})
            told = bool(done.get("warn"))
            _tell(api, run, "warn:%s" % day, captain_text(verdict, spent), None if told else user_text(verdict, spent),
                  notify_user)
            if not told and done.get("warn:%s" % day):
                done["warn"] = True
    except Exception as error:  # noqa: BLE001 - a brake that fails to read must not stop the Sentinella
        print("[bridge V6] WARN pi spend cap: %s" % error)


# --- the Captain's tool: the measured spending and the stop he commits to (JHT-T349) -------------------------------------
#
#   python3 /app/shared/skills/pi_spend_cap.py now [--json]          what was spent, at what rate (last 10 min), when the stop or
#                                                                    the budget is reached at that rate
#   python3 /app/shared/skills/pi_spend_cap.py stop-at <usd>         «I stop at X $» becomes a ceiling the brake applies
#   python3 /app/shared/skills/pi_spend_cap.py stop-at --clear       only on the person's word

def _cli_home():
    home = os.environ.get("JHT_HOME")
    return Path(home) if home else Path.home() / ".jht"


def _cli_config(home):
    data = _read_state(home / "jht.config.json", 4 * 1024 * 1024)
    return data if isinstance(data, dict) else {}


def report(home, now_ts):
    """The figures of `now`: spent (budget or today), the measured rate, the stop, and the minutes to the stop and to the budget at
    that rate (None when the rate is zero or the line is already behind)."""
    config = _cli_config(home)
    budget = team_budget.read(config, home)
    spent = spend(home, now_ts, budget["counts_from"] if budget else None, budget["starts"] if budget else None)
    figure, counts = counted(spent, budget)
    rate = measured(home, now_ts)
    stop = read_stop_at(home)

    def minutes_to(line):
        if line is None or rate["usd_per_min"] <= 0 or figure >= line:
            return None
        return round((line - figure) / rate["usd_per_min"], 1)

    return {"spent_usd": round(figure, 4), "counts": counts, "budget_usd": budget["usd"] if budget else None,
            "usd_per_min": rate["usd_per_min"], "window_min": rate["window_min"], "workers": rate["workers"],
            "workers_usd_per_min": rate["workers_usd_per_min"], "by_agent_usd_per_min": rate["by_agent_usd_per_min"],
            "stop_at_usd": stop["usd"] if stop else None, "minutes_to_stop": minutes_to(stop["usd"] if stop else None),
            "minutes_to_budget": minutes_to(budget["usd"] if budget else None)}


def _report_text(r):
    where = "since the budget started" if r["counts"] == "budget" else "today"
    lines = ["Spent %s USD %s%s." % (_money(r["spent_usd"]), where,
                                     " of a %s USD budget" % _money(r["budget_usd"]) if r["budget_usd"] else ""),
             "Measured rate, last %g min: %.4f USD/min (workers: %d, %.4f USD/min)." % (
                 r["window_min"], r["usd_per_min"], r["workers"], r["workers_usd_per_min"])]
    for name, value in r["by_agent_usd_per_min"].items():
        lines.append("  %s: %.4f USD/min" % (name, value))
    if r["stop_at_usd"] is not None:
        lines.append("Your stop: %s USD%s." % (_money(r["stop_at_usd"]), "" if r["minutes_to_stop"] is None else
                                               ", reached in ~%g min at this rate" % r["minutes_to_stop"]))
    if r["minutes_to_budget"] is not None:
        lines.append("The budget is reached in ~%g min at this rate." % r["minutes_to_budget"])
    lines.append("Project with THESE figures (scaling_calc.py --unit usd-min), never with a cost per worker of your own.")
    return "\n".join(lines)


def main(argv=None):
    import argparse
    import sys
    import time as _time

    parser = argparse.ArgumentParser(prog="pi_spend_cap.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    now_p = sub.add_parser("now", help="spent, measured rate in USD/min, time to the stop and to the budget")
    now_p.add_argument("--json", action="store_true")
    stop_p = sub.add_parser("stop-at", help="the stop you commit to, applied by the brake as a ceiling")
    stop_p.add_argument("usd", nargs="?", type=float)
    stop_p.add_argument("--clear", action="store_true")
    stop_p.add_argument("--by", default="capitano")
    args = parser.parse_args(argv)
    home = _cli_home()
    if args.cmd == "now":
        r = report(home, _time.time())
        print(json.dumps(r) if args.json else _report_text(r))
        return 0
    path = home / STOP_AT_FILE
    if args.clear:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        print("Stop cleared: the brake lifts its pause at its next look (about a minute) if nothing else holds the team.")
        return 0
    if args.usd is None or _positive(args.usd) is None or math.isinf(args.usd):
        print("stop-at needs a positive amount in USD, or --clear", file=sys.stderr)
        return 2
    _write_state(path, {"usd": round(float(args.usd), 4), "set_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "by": str(args.by)[:40]})
    if read_stop_at(home) is None:
        print("the stop could not be written", file=sys.stderr)
        return 1
    r = report(home, _time.time())
    print("Stop set at %s USD: the brake pauses the team there (one margin before, looking one minute ahead)." % _money(args.usd))
    print(_report_text(r))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
