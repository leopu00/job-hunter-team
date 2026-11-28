#!/usr/bin/env python3
"""burst_roster.py — starts the first-run roster in budget-checked stages.
One Scout, one Analista and one Scorer start first; additional Scouts wait for
the observation interval enforced by burst_budget.py, including direct spawns.

Before, the Capitano started the roster itself, one model turn and one `sleep 12` per worker: the formation took about four
minutes and the fifth Scout got its brief 2.8 minutes after the profile was ready (measured 11/11, run 6: a Scout needs
~25 s from its brief to its first command, the rest was the queue of spawns). Now one command starts every missing
worker through `start-agent.sh`, which sends the brief itself once the REPL is up (`JHT_WORKER_BRIEF`), so no worker
waits for the one before it to be briefed.

  burst_roster.py start [--auto] [--detach] [--force]   start what `first_run.py status` says is missing
  burst_roster.py plan                                  the order and the briefs, nothing started

`--auto`  (the system at the start of the Capitano): only when the burst is open and NO worker of the roster is alive,
          i.e. the burst has just opened or every session is gone. A Capitano that stopped a Scout on purpose is
          never answered with a new one.
`--detach` run in a session of its own and return at once (the start of the Capitano must not wait for ten spawns).
A stop that comes in the middle wins: before EACH worker the brakes that hold the whole team (the person's stop, the standby,
the daily and weekly halts) are read again, and a worker whose start ends after `.team-halted.flag` appeared (`jht team stop`
writes it before it lists the sessions to close, so it may miss that one) is closed at once and marked stopped. The burst
keeps no other brake of its own: the hours and the capacity are not read here, as before.
A second call within RECENT_S seconds of the first does nothing (the numbers of the workers are rolled one by one: two
runs at once would start the same roster twice); `--force` is for a person.

Prints one JSON object; exit 0 always except a bad command line (2).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
RECENT_S = 180  # a run this young is still starting the roster
SPAWN_TIMEOUT_S = 150  # one start-agent.sh (it waits for the spawn lock, up to ~75 s, and starts the REPL)
ORDER = ("scout", "analista", "scorer", "scout", "scout", "scout", "scout", "analista", "analista", "scorer")
ROLES = ("scout", "analista", "scorer")


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _launcher() -> str:
    return os.environ.get("JHT_START_AGENT") or "/app/.launcher/start-agent.sh"


def order(missing: dict) -> list[str]:
    """The roles to start, in the order of the skill: the first N of each role in ORDER, then any role beyond it
    (a roster larger than the table) at the end, Scouts last."""
    left = {role: int(missing.get(role) or 0) for role in ROLES}
    out: list[str] = []
    for role in ORDER:
        if left[role] > 0:
            out.append(role)
            left[role] -= 1
    for role in ("analista", "scorer", "scout"):
        out.extend([role] * max(0, left[role]))
    return out


def brief(role: str, number: int, cap: int | None) -> str:
    """What the Capitano used to write to a worker it had just started; English, the launcher adds the team language."""
    head = f"[@capitano -> @{role}-{number}] [MSG]"
    if role == "scout":
        first = (f"Your first command: `python3 /app/shared/skills/scout_coord.py auto scout-{number}` — it gives your lane, "
                 "your first search and the sources to avoid; run it before you read anything else. ")
        limit = (f"FIRST PASS (first run): at most {cap} positions this round — report when you reach it, do not search further. "
                 if cap else "")
        return (f"{head} Start the main loop. {first}Then read the candidate profile ($JHT_HOME/profile/candidate_profile.yml) "
                f"and go on from CIRCLE 1 (the primary preference). {limit}Notify the Analisti after each insert (never wait for a batch).")
    if role == "analista":
        return (f"{head} Start the main loop. Queue: db_query.py next-for-analista. For each position fill the 5 mandatory "
                "fields and promote it to checked or excluded. The very first position (first run): do it at once, do not wait for full queues.")
    return (f"{head} Start the main loop. Queue: db_query.py next-for-scorer. PRE-CHECK first, then the score 0-100. "
            "Gate: <40 excluded, 40-49 parked, >=50 notify the Scrittori. The very first checked position (first run): score it as soon as it arrives.")


def _json(*argv: str) -> dict:
    try:
        done = subprocess.run([sys.executable, *argv], capture_output=True, text=True, timeout=25, check=False)
        value = json.loads(done.stdout) if done.stdout.strip() else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _marker() -> Path:
    return _home() / "state" / "burst-roster.json"


def _recent() -> bool:
    try:
        started = float(json.loads(_marker().read_text(encoding="utf-8")).get("started_at"))
    except (OSError, ValueError, TypeError, AttributeError):
        return False
    return 0 <= time.time() - started < RECENT_S


@contextlib.contextmanager
def _exclusive():
    """One run at a time: an exclusive lock on a file of its own, taken BEFORE a number is rolled and held to the end of
    the run (a child process does not inherit it). Yields False when another run holds it; a system without fcntl yields True."""
    try:
        import fcntl
    except ImportError:
        yield True
        return
    try:
        path = _home() / "state" / "burst-roster.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a", encoding="utf-8")
    except OSError:
        yield True  # no lock can be made: the marker still refuses a second run that comes later
        return
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        yield True
    finally:
        handle.close()


def _write_marker() -> None:
    try:
        _marker().parent.mkdir(parents=True, exist_ok=True)
        _marker().write_text(json.dumps({"started_at": time.time(), "pid": os.getpid()}), encoding="utf-8")
    except OSError:
        pass  # not recorded: a second run is then not refused, and start-agent.sh still never spawns over a live session


def _log(event: dict) -> None:
    try:
        path = _home() / "logs" / "burst-roster.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(dict(event, ts=int(time.time()))) + "\n")
    except OSError:
        pass


def _number(role: str) -> int | None:
    done = subprocess.run([sys.executable, str(SKILLS / "roll_worker_number.py"), role],
                          capture_output=True, text=True, timeout=15, check=False)
    text = done.stdout.strip()
    return int(text) if done.returncode == 0 and text.isdigit() else None


def plan(state: dict, auto: bool) -> dict:
    """What to start now, from `first_run.py status`: {"start": [...roles], "why_not": "..."}."""
    if state.get("phase") != "burst":
        return {"start": [], "why_not": f"the first run is not in a burst (phase {state.get('phase')})"}
    if state.get("roster_check") == "unavailable" or "roster_missing" not in state:
        return {"start": [], "why_not": "the sessions cannot be read: nothing is assumed"}
    if auto and sum(int(n or 0) for n in (state.get("roster_alive") or {}).values()) > 0:
        return {"start": [], "why_not": "a worker of the roster is already up: the Capitano starts what is missing"}
    roles = order(state.get("roster_missing") or {})
    return {"start": roles, "why_not": "" if roles else "the roster is complete"}


def start(auto: bool, force: bool) -> dict:
    state = _json(str(SKILLS / "first_run.py"), "status")
    decision = plan(state, auto)
    if not decision["start"]:
        return {"started": [], "note": decision["why_not"]}
    with _exclusive() as free:
        if not free:
            return {"started": [], "note": "another run is starting the roster right now: look at `first_run.py status` in a minute"}
        if _recent() and not force:
            return {"started": [], "note": f"the roster was started less than {RECENT_S} s ago: look at `first_run.py status` in a minute"}
        _write_marker()
        return {"started": _spawn(decision["start"], state), "note": "start-agent.sh sends each brief when the REPL is up"}


# the brakes of queue_demand.brake() that hold the whole team: a burst that meets one of them starts nobody else
STOP_BRAKES = ("team-halted", "team-standby", "daily-halt", "weekly-halt")


_SKILLS_LOADED: dict = {}


def _skill(name: str):
    if name not in _SKILLS_LOADED:
        _SKILLS_LOADED[name] = _load_skill(name)
    return _SKILLS_LOADED[name]


def _load_skill(name: str):
    try:
        import importlib.util
        if str(SKILLS) not in sys.path:
            sys.path.insert(0, str(SKILLS))
        spec = importlib.util.spec_from_file_location(name, SKILLS / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:  # noqa: BLE001
        return None


def _stop_brake() -> str | None:
    """The brake that holds the whole team right now, or None. A queue_demand that does not load, or raises, leaves the flag of
    the stop (the burst did not read the other brakes before: an unreadable one does not hold the first run)."""
    queue = _skill("queue_demand")
    if queue is None:
        return "team-halted" if _stopped_by_the_person() else None
    try:
        reason = queue.brake(time.time(), 0)
    except Exception:  # noqa: BLE001 — the burst never read these brakes: a module that raises leaves the flag of the stop
        return "team-halted" if _stopped_by_the_person() else None
    return reason if reason in STOP_BRAKES else None


def _stopped_by_the_person() -> bool:
    try:
        return (_home() / ".team-halted.flag").exists()
    except OSError:
        return True


def _close_started(session: str) -> bool:
    """A worker started across the stop: closed, and the roster says `stopped` by the user, as `jht team stop` would have written."""
    try:
        closed = subprocess.run(["tmux", "kill-session", "-t", "=" + session], capture_output=True, text=True, timeout=15,
                                check=False, stdin=subprocess.DEVNULL).returncode == 0
    except (OSError, subprocess.SubprocessError):
        closed = False
    roster = _skill("team_roster")
    try:
        if roster is not None:
            roster.stop_mark([session], by="user")
    except Exception:  # noqa: BLE001 — a roster that cannot be written never undoes the close
        pass
    return closed


def _budget_admission(role: str) -> dict:
    mod = _skill("burst_budget")
    if mod is None:
        return {"allowed": role == "scorer", "reason": "burst-accounting-unavailable"}
    return mod.check(role, spawn=True)


def _wait_stage(seconds: float) -> bool:
    """Observe between Scout starts; recheck the person's stop every second."""
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if _stop_brake():
            return False
        time.sleep(min(1.0, max(0.0, until - time.monotonic())))
    return True


def _spawn(roles: list[str], state: dict) -> list[dict]:
    cap = state.get("scout_cap_first_pass")
    cap = cap if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0 else None
    done: list[dict] = []
    for role in roles:
        held = _stop_brake()
        if held:   # a stop, a standby or a halt came while the workers before were starting: nobody else starts
            done.append({"role": role, "ok": False, "why": f"brake: {held}"})
            break
        admission = _budget_admission(role)
        while admission.get("reason") == "burst-stage":
            if not _wait_stage(float(admission.get("retry_after_s") or 1)):
                done.append({"role": role, "ok": False, "why": "brake during stage"})
                return done
            admission = _budget_admission(role)
        if not admission.get("allowed"):
            row = {"role": role, "ok": False, "why": admission.get("reason", "burst-reserve")}
            done.append(row)
            _log(row)
            continue
        number = _number(role)
        if number is None:
            done.append({"role": role, "ok": False, "why": "no free number"})
            continue
        env = dict(os.environ, JHT_WORKER_BRIEF=brief(role, number, cap), JHT_BURST_STAGE_CLAIMED="1")
        try:
            result = subprocess.run(["bash", _launcher(), role, str(number)], capture_output=True, text=True,
                                    timeout=SPAWN_TIMEOUT_S, check=False, env=env, stdin=subprocess.DEVNULL)
            row = {"role": role, "number": number, "ok": result.returncode == 0, "rc": result.returncode}
            if result.returncode != 0:
                row["tail"] = (result.stderr or result.stdout)[-200:]
        except (OSError, subprocess.SubprocessError) as exc:
            row = {"role": role, "number": number, "ok": False, "why": type(exc).__name__}
        if row["ok"] and _stopped_by_the_person():
            row["closed_by_stop"] = _close_started(f"{role.upper()}-{number}")
        done.append(row)
        _log(row)
    return done


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("command", choices=["start", "plan"])
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--detach", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "plan":
        state = _json(str(SKILLS / "first_run.py"), "status")
        decision = plan(state, args.auto)
        cap = state.get("scout_cap_first_pass")
        print(json.dumps(dict(decision, briefs={r: brief(r, 1, cap if isinstance(cap, int) else None) for r in ROLES}), indent=1))
        return 0
    if args.detach:
        flags = [a for a in ("--auto", "--force") if getattr(args, a[2:])]
        try:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "start", *flags], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            print(json.dumps({"detached": True}))
        except OSError as exc:
            print(json.dumps({"detached": False, "why": type(exc).__name__}))
        return 0
    print(json.dumps(start(args.auto, args.force), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
