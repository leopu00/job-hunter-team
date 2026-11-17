#!/usr/bin/env python3
"""queue_demand.py — a position that waits in a queue nobody works: the system starts the one worker that is missing.

In the first run (the burst) the whole formation is started by the system. Past it (`steady`) the team is what the
Capitano and the watchdog's roster keep alive, and the roster only brings back a worker that was WORKING when it went.
A team whose Scouts found positions but whose Analista and Scorer were never started (a container taken over from a
run of days ago, a Capitano busy with something else) leaves the positions in `new` for ever: the person sees nothing.

Once a queue (analista: `new`; scorer: `checked` without a score, the same count the pacing reads) has waited WAIT_S
with no session of its role alive, `next` names ONE worker to start: `<role> <instance> <SESSION>`. Never more than that
one (the Capitano scales a role up or down from there), and never against a brake:

  · not in `steady` (the burst has its own roster, and `awaiting_profile` has nothing to work);
  · the standby, a halt (`.team-halted`, the daily and weekly halts, which is where the spending brake of a spent budget
    stops the team), the hours outside the working window, an agent the person paused or the team contained: nothing; a
    brake that cannot be read (standby, hours, capacity) counts as a brake;
  · a machine at its worker capacity (`plan_registry._host_agent_cap`): nothing;
  · COOLDOWN_S between two starts of the same role, and DAILY_CAP starts a day in all: a worker that dies at once is
    not started in a loop (the watchdog's own backoff for a failing spawn is applied by the caller as well).

The start itself is `start-agent.sh <role> <instance>`, which has the spend gate of the harness inside it.

  queue_demand.py next      prints `<role> <instance> <SESSION>` (and records the claim), or nothing
  queue_demand.py status    what it sees, as JSON; changes nothing

Never raises: anything it cannot read is no demand.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
ROLES = ("analista", "scorer")                 # the roles whose queue is a pile of positions (db_query.role_queue_count)
WAIT_S = int(os.environ.get("JHT_QUEUE_DEMAND_WAIT_S", "600"))          # the Capitano has this long to start one itself
COOLDOWN_S = int(os.environ.get("JHT_QUEUE_DEMAND_COOLDOWN_S", "1800"))
DAILY_CAP = int(os.environ.get("JHT_QUEUE_DEMAND_DAILY_CAP", "6"))
INSTANCE = 1
_MODULES: dict = {}


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _state_path() -> Path:
    return _home() / "state" / "queue-demand.json"


def _load(name: str):
    """A sibling module of shared/skills, loaded once; None when it cannot be loaded."""
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


# ── The readings (each one a seam for the tests) ─────────────────────────────
def phase() -> str | None:
    mod = _load("first_run")
    try:
        return str(mod.status().get("phase")) if mod is not None else None
    except Exception:  # noqa: BLE001
        return None


def queue_count(role: str) -> int | None:
    """How many positions wait for `role`; None when the database cannot be read."""
    mod = _load("db_query")
    if mod is None:
        return None
    try:
        conn = mod.get_db()
        try:
            return int(mod.role_queue_count(conn, role))
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return None


def live_sessions() -> list[str] | None:
    """Names of the tmux sessions, or None when tmux cannot be asked."""
    try:
        res = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        # no server at all: no session is alive
        return [] if "no server running" in (res.stderr or "").lower() or "no sessions" in (res.stderr or "").lower() else None
    return [line.strip() for line in res.stdout.splitlines() if line.strip()]


def brake(now: float, live_workers: int) -> str | None:
    """Why the system must NOT start anyone right now, or None. A brake that cannot be READ (the standby, the working hours, the
    capacity of the machine: the module breaks, or raises) is a brake: nothing is started. A machine whose capacity is not
    MEASURABLE (the module answers «none») has no cap to exceed, as for the step-cap watchdog."""
    home = _home()
    standby = _load("standby")
    try:
        if standby is not None and hasattr(standby, "is_active"):
            if standby.is_active(home=home):
                return "team-standby"
        elif (home / ".team-standby.flag").exists():
            return "team-standby"
    except Exception:  # noqa: BLE001
        return "team-standby"
    for name, path in (("team-halted", home / ".team-halted.flag"), ("daily-halt", home / ".daily-halt.flag"),
                       ("daily-halt", home / "logs" / "daily-halt.flag"), ("weekly-halt", home / ".weekly-halt.flag"),
                       ("weekly-halt", home / "logs" / "weekly-halt.flag")):
        try:
            if path.exists():
                return name
        except OSError:
            return name
    hours = _load("working_hours")
    if hours is None:
        return "hours-unreadable"
    try:
        if not hours.is_within_working_hours(datetime.fromtimestamp(now, timezone.utc)):
            return "off-hours"
    except Exception:  # noqa: BLE001
        return "hours-unreadable"
    registry = _load("plan_registry")
    if registry is None:
        return "capacity-unreadable"
    try:
        cap = registry._host_agent_cap()  # noqa: SLF001 — the one source of the RAM cap
    except Exception:  # noqa: BLE001
        return "capacity-unreadable"
    if cap is not None and live_workers >= cap:
        return "capacity"
    return None


def held_back(session: str) -> bool:
    """True when the person paused this agent or the team contained it: it is not started under their hands."""
    pause = _load("agent_pause")
    try:
        if pause is not None and pause.is_paused(session, home=_home()):
            return True
    except Exception:  # noqa: BLE001
        pass
    roster = _load("team_roster")
    try:
        if roster is not None and hasattr(roster, "is_contained") and roster.is_contained(session):
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


# ── The record ───────────────────────────────────────────────────────────────
def _read_state() -> dict:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(state: dict) -> None:
    try:
        path = _state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def _is_role_session(name: str, role: str) -> bool:
    return re.fullmatch(role.upper() + r"(-\d+)?", name.strip().upper()) is not None


def decide(now: float | None = None, write: bool = True) -> dict:
    """What to do right now: {"start": [role, instance, session] | None, "why": str, "waiting": {...}}."""
    now = time.time() if now is None else float(now)
    state = _read_state()
    waiting_since = state.get("waiting_since") if isinstance(state.get("waiting_since"), dict) else {}
    starts = [float(t) for t in (state.get("starts") or []) if isinstance(t, (int, float)) and now - float(t) < 86400]
    last = state.get("last") if isinstance(state.get("last"), dict) else {}
    out: dict = {"start": None, "why": "", "waiting": {}}

    def finish(why: str) -> dict:
        out["why"] = why
        if write:
            _write_state({"waiting_since": waiting_since, "starts": starts, "last": last})
        return out

    if phase() != "steady":
        waiting_since.clear()
        return finish("not-steady")
    sessions = live_sessions()
    if sessions is None:
        return finish("no-tmux-reading")
    workers = [s for s in sessions if re.fullmatch(r"(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)(-\d+)?", s.strip().upper())]
    for role in ROLES:
        alive = any(_is_role_session(s, role) for s in sessions)
        count = queue_count(role)
        if alive or not count:
            waiting_since.pop(role, None)
            continue
        since = float(waiting_since.setdefault(role, now))
        out["waiting"][role] = {"count": count, "for_s": int(now - since)}
    for role in ROLES:
        info = out["waiting"].get(role)
        if info is None or info["for_s"] < WAIT_S:
            continue
        session = f"{role.upper()}-{INSTANCE}"
        if now - float(last.get(role) or 0) < COOLDOWN_S:
            return finish("cooldown")
        if len(starts) >= DAILY_CAP:
            return finish("daily-cap")
        if held_back(session):
            return finish("held-back")
        reason = brake(now, len(workers))
        if reason:
            return finish(reason)
        last[role] = now
        starts.append(now)
        out["start"] = [role, INSTANCE, session]
        return finish("start")
    return finish("nothing-waits" if not out["waiting"] else "waiting")


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else "status"
    if command not in ("next", "status"):
        print("usage: queue_demand.py next|status", file=sys.stderr)
        return 2
    try:
        result = decide(write=command == "next")
    except Exception as exc:  # noqa: BLE001 — never an error for the watchdog's tick
        if command == "status":
            print(json.dumps({"start": None, "why": f"error: {exc}"}))
        return 0
    if command == "status":
        print(json.dumps(result, sort_keys=True))
    elif result["start"]:
        print("%s %s %s" % tuple(result["start"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
