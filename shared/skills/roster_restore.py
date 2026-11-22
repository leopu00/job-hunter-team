#!/usr/bin/env python3
"""roster_restore.py — after an update or a restart the system brings back the workers that were running, at once.

The first run has its roster started by the system (burst_roster.py). Past it (`steady`) a restart left the team to the
Capitano and to the watchdog's roster: the Capitano took its time (it wants to look at the spending first), and the watchdog
brings back ONE worker per tick, three an hour (its cap exists for the day a brake kills every Sonnet, not for an update). On a Mac
after an update the team had one Scout after 11 minutes and one position before the brake paused it.

At the start of the Capitano, when the first run is over and NO worker is alive, this starts the workers the roster says were working
before the stop, in the order of the burst (two Scouts, an Analista, a Scorer, the rest), each with the brief to resume the main loop:

  * only a worker with a sign of life in the last JHT_ROSTER_RESTORE_WINDOW_H hours (6): one the Capitano had removed long ago is not
    brought back;
  * never against a brake: the standby, a halt (the daily and weekly halts are where a spent budget stops the team), the hours outside
    the working window, an agent the person paused or the team contained, the capacity of the machine (the workers started never
    exceed what the machine carries), and the spend gate of the harness is in `start-agent.sh` as for any start;
  * one run per boot: a second call within an hour does nothing.

The opening of the working window is the exception to «no worker alive» and to the hour: the workers the close of the hours stopped
(`stopped` by `hours` in the roster) come back at the opening even when another worker is already up (a queue that started one, a
Capitano that started one), and every check of the watchdog brings back the ones still missing, until the cap. On 21/11 the workers
came back one by one from 08:31 to 10:02. A start that fails is tried again at the next check, JHT_ROSTER_RESTORE_MAX_TRIES times
in 12 hours (4); a role the core image cannot start (it needs the tools of the full image) waits for the full image without spending
a try (18/11: the Scouts and Analisti refused with exit 75).

The cap is session_cap.room(): the lowest of the roster's rule and the machine, never over eleven sessions in all. A retired worker is
never in the plan (the roster does not count it among the expected ones).

  roster_restore.py plan                 what it would start, nothing started
  roster_restore.py start [--detach]     start it (`--detach`: in a session of its own, return at once)

Prints one JSON object; exit 0 always except a bad command line.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
ROLES = ("scout", "analista", "scorer")
WINDOW_H = float(os.environ.get("JHT_ROSTER_RESTORE_WINDOW_H", "6"))
ONCE_S = 3600.0
# a worker stopped for the hours on Friday at 18:00 comes back on Monday at 08:00 (62 h): a week covers a holiday too
STOPPED_FOR_HOURS_H = 24.0 * 7
MAX_TRIES = int(os.environ.get("JHT_ROSTER_RESTORE_MAX_TRIES", "4"))
TRIES_WINDOW_S = 12 * 3600.0
_MODULES: dict = {}


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


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
    except Exception:  # noqa: BLE001
        mod = None
    _MODULES[name] = mod
    return mod


def _marker() -> Path:
    return _home() / "state" / "roster-restore.json"


def _done_recently(now: float) -> bool:
    try:
        return 0 <= now - float(json.loads(_marker().read_text(encoding="utf-8")).get("at")) < ONCE_S
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def _read_marker() -> dict:
    try:
        data = json.loads(_marker().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _tries(now: float) -> dict:
    """{session: [moments of a failed start in the last 12 hours]}."""
    raw = _read_marker().get("tries")
    out = {}
    if isinstance(raw, dict):
        for session, moments in raw.items():
            kept = [float(t) for t in (moments or []) if isinstance(t, (int, float)) and 0 <= now - float(t) < TRIES_WINDOW_S]
            if kept:
                out[str(session)] = kept
    return out


def _write_marker(now: float, tries: dict | None = None) -> None:
    try:
        data = {"at": now, "pid": os.getpid(), "tries": _tries(now) if tries is None else tries}
        _marker().parent.mkdir(parents=True, exist_ok=True)
        tmp = _marker().with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, _marker())
    except OSError:
        pass


def _stopped_for_hours(entry) -> bool:
    return str(entry.get("status") or "") == "stopped" and str(entry.get("stop_by") or "") == "hours"


def _stopped_at(entry):
    try:
        moment = datetime.fromisoformat(str(entry.get("stopped_at")).replace("Z", "+00:00"))
        return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, AttributeError):
        return None


def _tools_missing() -> tuple:
    roster = _load("team_roster")
    try:
        return tuple(roster._tools_missing()) if roster is not None and hasattr(roster, "_tools_missing") else ()  # noqa: SLF001
    except Exception:  # noqa: BLE001 — without the reading the rules of always hold
        return ()


def phase() -> str | None:
    mod = _load("first_run")
    try:
        return str(mod.status().get("phase")) if mod is not None else None
    except Exception:  # noqa: BLE001
        return None


def _roster_entries():
    """(entries of the workers expected, or stopped by `jht team stop` / the close of the hours, and without a session, the
    sessions alive), or (None, None) when it cannot be read."""
    roster = _load("team_roster")
    if roster is None:
        return None, None
    try:
        alive = roster.live_sessions()
        return roster.missing(live=alive, include_stopped=True), alive
    except Exception:  # noqa: BLE001
        return None, None


def _spawned(entry):
    """When the roster says the worker was last started (an `active` entry: nobody removed it since)."""
    try:
        moment = datetime.fromisoformat(str(entry.get("last_spawn")).replace("Z", "+00:00"))
        return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, AttributeError):
        return None


def _last_sign(session: str, entry=None):
    """The latest sign of life: a message or an artifact (the roster's last_activity) or, for a worker that is still `active` in
    the roster, its own start. A Scout that was started minutes before the stop has sent no message and written no position yet
    (giro Mac 18/11: SCOUT-6 started at 06:56, `jht down` at 07:00, not brought back, the Capitano started another one)."""
    roster = _load("team_roster")
    try:
        seen = roster.last_activity(session, _home())
    except Exception:  # noqa: BLE001
        seen = None
    started = _spawned(entry or {})
    return max((m for m in (seen, started) if m is not None), default=None)


def plan(now: float | None = None) -> dict:
    """{"start": [[role, instance], ...], "why_not": str}: what to bring back right now."""
    now = time.time() if now is None else now
    if phase() != "steady":
        return {"start": [], "why_not": "the first run is not over (the burst has its own roster)"}
    entries, alive = _roster_entries()
    if entries is None:
        return {"start": [], "why_not": "the roster or the sessions cannot be read: nothing is assumed"}
    workers_alive = [s for s in alive if _is_worker(s)]
    opening = [e for e in entries if _stopped_for_hours(e)]
    if workers_alive or _done_recently(now):
        if not opening:
            if workers_alive:
                return {"start": [], "why_not": "a worker is already up: the Capitano and the watchdog bring back what is missing"}
            return {"start": [], "why_not": "the roster was restored less than an hour ago"}
        entries = opening   # the opening: the ones the close of the hours stopped come back next to who is up
    queue = _load("queue_demand")
    if queue is None:
        return {"start": [], "why_not": "the brakes cannot be read (queue_demand does not load): nothing is started"}
    try:
        reason = queue.brake(now, 0)
    except Exception:  # noqa: BLE001 — a brake that raises is a brake
        reason = "brakes-unreadable"
    if reason and reason != "capacity":
        return {"start": [], "why_not": f"a brake holds the team: {reason}"}
    now_dt = datetime.fromtimestamp(now, timezone.utc)
    cutoff = now_dt - timedelta(hours=WINDOW_H)
    hours_cutoff = now_dt - timedelta(hours=STOPPED_FOR_HOURS_H)
    tries = _tries(now)
    tools_missing = _tools_missing()
    found: dict = {role: [] for role in ROLES}
    waiting_tools = []
    for entry in entries:
        role = str(entry.get("role") or "")
        session = str(entry.get("session") or "")
        if role not in ROLES or not session or session in alive:
            continue
        if _stopped_for_hours(entry):
            # stopped while working by the close of the hours: its sign of life is the close itself
            stopped = _stopped_at(entry)
            if stopped is None or stopped < hours_cutoff:
                continue
        else:
            sign = _last_sign(session, entry)
            if sign is None or sign.astimezone(timezone.utc) < cutoff:
                continue
        if queue.held_back(session):
            continue
        if len(tries.get(session, [])) >= MAX_TRIES:
            continue
        if role in tools_missing:
            waiting_tools.append(session)
            continue
        try:
            found[role].append(int(entry.get("instance")))
        except (TypeError, ValueError):
            continue
    counts = {role: len(found[role]) for role in ROLES}
    if not any(counts.values()):
        if waiting_tools:
            return {"start": [], "why_not": "the workers wait for the tools of the full image: " + " ".join(sorted(waiting_tools))}
        return {"start": [], "why_not": "no worker of the roster showed a sign of life in the last %g hours" % WINDOW_H}
    burst = _load("burst_roster")
    sequence = burst.order(counts) if burst is not None else [r for r in ROLES for _ in range(counts[r])]
    cap = _load("session_cap")
    if cap is None:
        return {"start": [], "why_not": "the capacity of the machine cannot be read: nothing is started"}
    try:
        room = int(cap.room(sorted(alive)))   # the one cap: min(roster, machine), never over eleven sessions; 0 when unreadable
    except Exception:  # noqa: BLE001
        return {"start": [], "why_not": "the capacity of the machine cannot be read: nothing is started"}
    chosen: list = []
    taken = {role: 0 for role in ROLES}
    for role in sequence:
        if len(chosen) >= room:
            break
        numbers = sorted(found[role])
        if taken[role] < len(numbers):
            chosen.append([role, numbers[taken[role]]])
            taken[role] += 1
    out = {"start": chosen, "why_not": "" if chosen else "no room under the cap of the sessions (the capacity of the machine, the roster's rule, eleven sessions)"}
    # the pace's line: the workers come back by stages like after a lift of the pace (the Scouts first; a worker whose reload and work do not
    # fit waits: the watchdog roster brings it back later). Seven workers started together spent 0.06 $ over the line (retest 8d5f09a2b).
    pace = _load("pi_spend_cap")
    fit = None
    if chosen and pace is not None:
        try:
            fit = pace.stage_fit(_home(), now, ["%s-%s" % (role.upper(), number) for role, number in chosen])
        except Exception:  # noqa: BLE001
            fit = {"taken": [], "waiting": ["?"], "estimate": 0.0, "costs": {}}
    if fit is not None:
        allowed = set(fit["taken"])
        out["start"] = [[role, number] for role, number in chosen if "%s-%s" % (role.upper(), number) in allowed]
        out["pace"] = {"estimate": fit["estimate"], "costs": fit["costs"], "waiting": fit["waiting"]}
        if not out["start"]:
            out["why_not"] = "the pace leaves no room to work after a reload: the watchdog brings the workers back as the line rises"
    return out


def _is_worker(session: str) -> bool:
    import re
    return re.fullmatch(r"(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)(-\d+)?", str(session).strip().upper()) is not None


def _brief(role: str, number: int) -> str:
    burst = _load("burst_roster")
    base = burst.brief(role, number, None) if burst is not None else f"[@capitano -> @{role}-{number}] [MSG] Start the main loop."
    return base.replace("Start the main loop.", "The team was restarted (an update or a stop): resume the main loop.", 1)


def start(detach_ok: bool = True) -> dict:
    now = time.time()
    decision = plan(now)
    if not decision["start"]:
        return {"started": [], "note": decision["why_not"]}
    burst = _load("burst_roster")
    if burst is None:
        return {"started": [], "note": "the burst roster module cannot be read"}
    with burst._exclusive() as free:  # noqa: SLF001 — the lock the burst's own start takes: two runs never start the same worker
        if not free:
            return {"started": [], "note": "another run is starting workers right now"}
        _write_marker(now)
        tries = _tries(now)
        pace = decision.get("pace")
        if pace and pace.get("costs"):
            try:   # what the workers started are expected to cost stays under the line for two minutes, like the stages of a lift
                _load("pi_spend_cap").note_wake(_home(), now, pace["estimate"], pace["costs"])
            except Exception:  # noqa: BLE001
                pass
        done = []
        for role, number in decision["start"]:
            env = dict(os.environ, JHT_WORKER_BRIEF=_brief(role, number))
            try:
                result = subprocess.run(["bash", burst._launcher(), role, str(number)], capture_output=True, text=True,  # noqa: SLF001
                                        timeout=burst.SPAWN_TIMEOUT_S, check=False, env=env, stdin=subprocess.DEVNULL)
                row = {"role": role, "number": number, "ok": result.returncode == 0, "rc": result.returncode}
                if result.returncode != 0:
                    row["tail"] = (result.stderr or result.stdout)[-200:]
            except (OSError, subprocess.SubprocessError) as exc:
                row = {"role": role, "number": number, "ok": False, "why": type(exc).__name__}
            done.append(row)
            burst._log(dict(row, restore=True))  # noqa: SLF001
            if not row["ok"]:   # tried again at the next check of the watchdog, MAX_TRIES times in 12 hours
                session = "%s-%s" % (role.upper(), number)
                tries.setdefault(session, []).append(time.time())
        _write_marker(now, tries)
        return {"started": done, "note": "start-agent.sh sends each brief when the REPL is up"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("command", choices=["start", "plan"])
    parser.add_argument("--detach", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "plan":
        print(json.dumps(plan(), indent=1))
        return 0
    if args.detach:
        try:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "start"], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            print(json.dumps({"detached": True}))
        except OSError as exc:
            print(json.dumps({"detached": False, "why": type(exc).__name__}))
        return 0
    print(json.dumps(start(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
