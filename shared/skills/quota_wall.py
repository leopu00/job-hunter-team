"""quota_wall.py — the quota of the subscription is spent: the team stops, says so, and starts again by itself.

From 08/11 to 13/11 every Codex session of one team answered «usage limit» and nobody noticed: the team stayed on, each night it
brought up eight to ten sessions that failed at once, and the person was never told. The brake of the budget reads numbers; here
there were none to read, only the words of the provider on the screens of the workers.

Every look of the brake (about once a minute) this reads the last lines of the screen of each worker, and takes only the line
the CLI of the provider writes for its limit (never a text a tool or a page printed). When most of the workers
that are alive say the provider's limit, the team is put on pause (the pause of the person: the Assistente stays awake to answer),
the person is told in their language with the hour of the return when the screen says it, and the pause is bound to that hour. The
exit is the same `until` of every pause: the Sentinella removes the flag and sends [RIPRENDI]. When the screen did not say when,
the pause is a probe: it lasts PROBE_SEC, the workers try again, and if the limit is still there the next look pauses the team
again, without telling the person a second time within QUIET_SEC.

While the flag stands nobody is started: queue_demand, roster_restore and session_cap all ask the standby first.
`decide()` and `resume_at()` are pure: the tests drive them with made-up screens.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKER = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)(-\d+)?$")
# The line of the limit as each provider's CLI writes it, anchored at the start of the line (a sentence in the middle of a line, or
# inside the block of a tool, is somebody else's text: an announcement, a web page a Scout read). Codex: «■ You've hit your usage limit.
# … try again at 6:12 PM.» in the error box, above its composer. Claude: «Usage limit reached · resets at 18:00», «5-hour limit
# reached ∙ resets 3pm», a line of its own. Pi: « Error: …» above its composer, with the provider's words (usage limit, 429 rate limit,
# quota). Tool output and quotes are indented or carry a bullet of their own (│ └ ⎿ • ›), and none of those match.
CODEX_LINE = re.compile(r"^■ You(?:'|\u2019)ve hit your (?:usage )?limit\b")
CLAUDE_LINE = re.compile(r"^ {0,2}(?:Claude )?(?:usage limit reached|(?:5-hour|weekly|session|daily|opus weekly) limit reached)\b(?:[ \u2219\u00b7.,\u2014-]|$)", re.I)
PI_LINE = re.compile(r"^ {0,2}Error: .*(?:usage limit|rate.?limit|\b429\b|quota|hit your (?:usage )?limit)", re.I)
MAX_LINE = 240                 # a line of the CLI is short; a long one is a page
AFTER_LINES = 8                # after the limit only the footer of the CLI (blank, composer, rules, folder, totals): Pi's is five lines
LOOK_LINES = 14                # the lines of the screen read: the limit and the footer of the CLI after it
MIN_WORKERS = 2                # one screen is a worker's trouble; two are the provider's (a team of one worker needs only that one)
PROBE_SEC = 1800               # no hour on the screen: try again after this long
MARGIN_SEC = 120               # after the hour the screen gave
GRACE_SEC = 600                # after a resume the old words are still on the screens: look again only after this long
QUIET_SEC = 6 * 3600           # the person is told at most this often about a pause whose hour is not known
MAX_AHEAD = timedelta(days=8)
STATE_FILE = Path("state") / "quota-wall.json"
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
AT = re.compile(r"(?:try again at|resets?(?: at| on)?|available (?:again )?at)\s+(.+)", re.I)
CLOCK = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?", re.I)
DAY = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})", re.I)


def limit_line(tail):
    """The line the CLI of the provider wrote to say the limit, or None. It must be one of the shapes above and be at the end of the
    screen: only the footer of the CLI (at most AFTER_LINES lines, with the blanks left out) may follow it. Text a page or a tool
    printed, or an agent quoted, is neither anchored like that nor last."""
    lines = [str(l).rstrip() for l in tail if str(l).strip()]
    for back, line in enumerate(reversed(lines)):
        if back > AFTER_LINES:
            break
        if len(line) <= MAX_LINE and (CODEX_LINE.match(line) or CLAUDE_LINE.match(line) or PI_LINE.match(line)):
            return line.strip()
    return None


def resume_at(line, now):
    """The moment the screen says the quota comes back (local time of `now`), or None. «try again at 6:12 PM», «resets 3pm»,
    «try again at Nov 14th, 2026 6:12 PM». Past hours today mean tomorrow; more than MAX_AHEAD away is not believed."""
    found = AT.search(line or "")
    if not found:
        return None
    rest = found.group(1)
    day = DAY.search(rest)
    if day:
        rest = rest[:day.start()] + " " + rest[day.end():]
        rest = re.sub(r"\b(?:st|nd|rd|th)\b|\b20\d\d\b", " ", rest)
    clock = CLOCK.search(rest)
    if not clock or (clock.group(3) is None and clock.group(2) is None):
        return None
    hour, minute = int(clock.group(1)), int(clock.group(2) or 0)
    suffix = (clock.group(3) or "").lower().replace(".", "")
    if suffix == "pm" and hour < 12:
        hour += 12
    if suffix == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    try:
        if day:
            month = MONTHS[day.group(1).lower()]
            moment = now.replace(month=month, day=int(day.group(2)), hour=hour, minute=minute, second=0, microsecond=0)
            if moment <= now:
                moment = moment.replace(year=now.year + 1)
        else:
            moment = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if moment <= now:
                moment += timedelta(days=1)
    except ValueError:
        return None
    return moment if moment - now <= MAX_AHEAD else None


def decide(screens, now):
    """screens = {session: last lines of its screen}. None when the provider is not the problem; else
    {"sessions": [...], "line": the line to show, "resume": datetime or None}. Pure."""
    workers = {s: t for s, t in screens.items() if WORKER.match(str(s or "").upper())}
    said = {s: limit_line(t) for s, t in workers.items()}
    said = {s: l for s, l in said.items() if l}
    if not said or len(said) < min(MIN_WORKERS, len(workers)) or len(said) * 2 < len(workers):
        return None
    moments = [m for m in (resume_at(l, now) for l in said.values()) if m]
    return {"sessions": sorted(said), "line": next(iter(said.values())), "resume": min(moments) if moments else None}


def _load(name):
    spec = importlib.util.spec_from_file_location("quota_wall_" + name, HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


def read_screens():
    """{session: last non-empty lines} of the live tmux sessions that are workers."""
    names = subprocess.run(["tmux", "ls", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout.split()
    out = {}
    for name in names:
        if WORKER.match(name.upper()):
            shot = subprocess.run(["tmux", "capture-pane", "-p", "-t", name, "-S", "-20"], capture_output=True, text=True, timeout=10)
            out[name] = [l.rstrip() for l in shot.stdout.splitlines() if l.strip()][-LOOK_LINES * 2:]
    return out


def _write_state(home, data):
    path = Path(home) / STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(".%s.%d.tmp" % (path.name, os.getpid()))
    try:
        tmp.unlink()
    except OSError:
        pass
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    os.replace(str(tmp), str(path))


def clock_text(moment):
    return moment.strftime("%H:%M") if moment.date() == datetime.now(moment.tzinfo).date() else moment.strftime("%d/%m %H:%M")


def captain_text(resume):
    when = "at %s" % clock_text(resume) if resume else "at an hour the screens do not say (the system tries again every %d minutes)" % (PROBE_SEC // 60)
    return ("[BRIDGE INFO] THE QUOTA OF THE SUBSCRIPTION IS SPENT: the workers answer «usage limit». The system paused the team and "
            "the person was told. It resumes by itself %s. Nothing to do now: do not start workers and do not ask the person for "
            "anything; every start is refused until the pause is over." % when)


def assistant_text(resume):
    when = "at %s" % clock_text(resume) if resume else "at an hour not known yet (it tries again every %d minutes)" % (PROBE_SEC // 60)
    return ("[BRIDGE INFO] THE QUOTA OF THE SUBSCRIPTION IS SPENT. The provider's limit stopped the workers, so the team is paused and "
            "resumes by itself %s. You are NOT paused: if the person asks, tell them in their language and in plain words that the "
            "quota of their subscription is finished, that nobody works until it is back, that nothing is lost and that the team "
            "restarts alone. Do not wake the Capitano for new requests." % when)


def _notify_user(text, reason):
    return _load("quota_data")._notify_user(text, reason)


def _say(key, *args):
    return _load("quota_data").shared_i18n().tf(key, *args)


def user_text(resume):
    if resume:
        return _say("quota_wall.user_notice", clock_text(resume))
    return _say("quota_wall.user_notice_unknown", "%d" % (PROBE_SEC // 60))


def step(api, run, screens=None, notify_user=None, standby=None, now=None):
    """One look. Never raises. `screens`, `notify_user`, `standby` and `now` are for the tests."""
    try:
        from sentinel_delivery import notice

        standby = standby or _load("standby")
        now = now or datetime.now().astimezone()
        ts = now.timestamp()
        state = run.state.setdefault("quota_wall", {})
        home = api._path("JHT_HOME")
        active = standby.is_active(home=home)
        if state.get("on") and not active:                 # the pause is over (the Sentinella woke the team, or the person did)
            state.update(on=False, woke_at=ts)
            _write_state(home, {"on": False, "ended_at": int(ts)})
            return None
        if active or ts - float(state.get("woke_at") or 0.0) < GRACE_SEC:
            return None                                    # another pause holds the team, or the old words are still on the screens
        found = decide(screens if screens is not None else read_screens(), now)
        if not found:
            return None
        resume = found["resume"]
        until = resume + timedelta(seconds=MARGIN_SEC) if resume else now + timedelta(seconds=PROBE_SEC)
        reason = "the quota of the subscription is spent"
        standby.enter(reason=reason, until=until, by="quota", mode=standby.MODE_PAUSE)   # the flag first, the words after
        state.update(on=True, since=ts, resume=resume.isoformat(timespec="seconds") if resume else None)
        _write_state(home, {"on": True, "since": int(ts), "resumes_at": state["resume"], "probe": resume is None,
                            "until": until.isoformat(timespec="seconds"), "sessions": found["sessions"]})
        print("[bridge V6] QUOTA-WALL %d workers say the provider's limit (%r): team paused until %s"
              % (len(found["sessions"]), found["line"][:80], until.isoformat(timespec="minutes")))
        try:
            soft = _load("soft_pause_team")
            soft.pause_all(include_core=True, reason=reason, mode=standby.MODE_PAUSE, notify_assistant=False)
        except Exception as error:  # noqa: BLE001 - the flag already holds every start
            print("[bridge V6] WARN quota wall pause messages: %s" % error)
        standby.log_event("enter", reason=reason, mode=standby.MODE_PAUSE, until=until.isoformat(timespec="seconds"), requested_by="quota")
        notice(api, run.state, "quota_wall:assistant:%d" % int(ts), "ASSISTENTE", assistant_text(resume))
        notice(api, run.state, "quota_wall:captain:%d" % int(ts), api.CAPITANO_SESSION, captain_text(resume))
        if resume or ts - float(state.get("told_at") or 0.0) >= QUIET_SEC:
            try:
                (notify_user or _notify_user)(user_text(resume), "quota-wall-%d" % int(ts))
                state["told_at"] = ts
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN quota wall user notice: %s" % error)
        return found
    except Exception as error:  # noqa: BLE001 - a guard that fails must not stop the tick
        print("[bridge V6] WARN quota wall: %s" % error)
        return None
