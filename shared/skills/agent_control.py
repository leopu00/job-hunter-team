#!/usr/bin/env python3
"""The agents' control panel, container side: one place for every rule.

The desktop app reaches this file in two ways, and only these:

  * with arguments, for an action or a read (local team: the attested `jht`
    wrapper runs `jht agent-control ...`; a VPS team: a fixed
    `docker exec ... python3 /app/shared/skills/agent_control.py ...`):

        agent_control.py start|stop|restart SESSION
        agent_control.py pause (--for-hours N | --until ISO | --wake-on-weekly)
        agent_control.py resume
        agent_control.py list | screen SESSION | team

  * without arguments, with one JSON request on stdin, for the reads only
    (`{"op":"list"}`, `{"op":"screen","name":...}`, `{"op":"team"}`). This is
    the read-only view's channel: on stdin an action is refused, always.

Nothing here takes free text: no keys and no message ever reach an agent's
terminal. A session is a name from a closed grammar, an action is one of five
words, and a pause needs an exit condition (`standby.py`: a standby without
one is not written).

Every answer is one JSON line on stdout. An action exits with a closed code
(EXIT below), which the app turns into a sentence of its error catalog.

Stopping must hold. The watchdog brings a core role back in about 30 s and
respawns a busy worker, unless the session is contained (`team_roster.py
contain`): that is the only mark every respawn path and the 12 h refresh
respect. So «Spegni» contains the session with by=user and a fixed reason,
then kills it; «Accendi» lifts that same hold, and only that one: a hold
another agent put for safety is not the user's to lift from here.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - the container is Linux
    fcntl = None


# ── closed codes ────────────────────────────────────────────────────────────
# 0 is done, or already in the state asked. 2 is what python3 answers for a
# missing file: an image older than this panel (the app says «update the
# team»). The 100 range stays clear of the pinned target's 70.
EXIT = {
    "agent_control_invalid": 100,
    "agent_control_refused": 101,
    "agent_control_busy": 102,
    "disk_low": 103,
    "closer_not_consented": 104,
    "agent_start_failed": 105,
    "agent_stop_failed": 106,
    "agent_not_running": 107,
    "team_halted": 108,
    "team_pause_failed": 109,
    "team_resume_failed": 110,
    "agent_contained": 111,
    "team_paused": 112,
}

# Who and why, as the roster's journal shows them: distinct from a safety
# containment (by CAPITANO, by the doctor...) at a glance.
USER = "user"
USER_STOP_REASON = "stopped by the user from the app"
USER_START_REASON = "started by the user from the app"
PAUSE_REASON = "paused by the user from the app"
RESUME_REASON = "resumed by the user from the app"
SPAWN_SRC = "desktop-panel"

MAX_PAUSE = timedelta(days=7)
# The journal keeps one previous file: an action is a line of ~150 bytes, so
# the two hold thousands of them and never grow without end.
JOURNAL_MAX_BYTES = 256 * 1024

# ── the sessions ────────────────────────────────────────────────────────────
NAME = re.compile(r"^[A-Z][A-Z0-9-]{0,39}$")
# Singletons the panel starts and stops (start-agent.sh: bare prefix).
SINGLETONS = {"CAPITANO": "capitano", "ASSISTENTE": "assistente", "MENTOR": "mentor",
              "SENTINELLA": "sentinella", "CRITICO": "critico"}
# Numbered roles: PREFIX-n, n a positive number without a leading zero.
NUMBERED = {"SCOUT": "scout", "ANALISTA": "analista", "SCORER": "scorer",
            "SCRITTORE": "scrittore", "CLOSER": "closer"}
NUMBERED_RE = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)-([1-9][0-9]{0,3})$")
# The writer's reviewers: the writer spawns and kills them (critic-loop), so
# the panel may stop one and never starts one.
REVIEWER_RE = re.compile(r"^CRITICO-S([1-9][0-9]{0,3})$")
# Shown, never touched: their scheduler (doctor-watchdog.sh) replaces them.
NO_ACTIONS = {"DOTTORE", "MANTENITORE"}

# ── where things are ────────────────────────────────────────────────────────
# Run from stdin (the read-only channel: `exec` of the app's own copy) the
# file has no __file__: it is the container's skills folder all the same.
HERE = Path(globals().get("__file__") or "/app/shared/skills/agent_control.py").resolve().parent


def _first(*candidates: Path) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


SKILLS = Path("/app/shared/skills")
START_AGENT = _first(Path("/app/.launcher/start-agent.sh"), HERE.parent.parent / ".launcher" / "start-agent.sh")
APPLY_GATE = _first(SKILLS / "apply_gate.py", HERE / "apply_gate.py")
HOST_VITALS = _first(SKILLS / "host_vitals.py", HERE / "host_vitals.py")
AGENT_STATE = _first(SKILLS / "agent_state.py", HERE / "agent_state.py")
REDACTOR = _first(Path("/app/shared/redact-cli.mjs"), HERE.parent / "redact-cli.mjs")
START_TIMEOUT_S = 120
KILL_TIMEOUT_S = 15


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def _load(name: str, filename: str):
    for candidate in (SKILLS / filename, HERE / filename):
        if candidate.exists():
            spec = importlib.util.spec_from_file_location(name, candidate)
            module = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(module)
            return module
    raise RuntimeError(f"{filename} not found")


def roster():
    return _load("agent_control_roster", "team_roster.py")


def standby():
    return _load("agent_control_standby", "standby.py")


# ── answers ─────────────────────────────────────────────────────────────────
class Refusal(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _journal(entry: dict) -> None:
    try:
        path = jht_home() / "logs" / "agent-control.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size >= JOURNAL_MAX_BYTES:
            path.replace(path.with_name(path.name + ".1"))
        with path.open("a", encoding="utf-8") as out:
            out.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except OSError:
        pass


def _emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")))


# ── tmux ────────────────────────────────────────────────────────────────────
def _tmux(*args: str, timeout: int = 8) -> subprocess.CompletedProcess:
    return subprocess.run(["tmux", *args], capture_output=True, text=True, timeout=timeout)


def alive(session: str) -> bool:
    try:
        return _tmux("has-session", "-t", f"={session}").returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _kill(session: str) -> bool:
    """Kills the exact session; True once it is gone."""
    if alive(session):
        try:
            _tmux("kill-session", "-t", f"={session}", timeout=KILL_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired):
            pass
    return not alive(session)


# ── the grammar ─────────────────────────────────────────────────────────────
def parse_session(session: str) -> tuple[str, str | None, str]:
    """(role, instance, kind) of a session, kind in agent|reviewer|scheduled.

    Refuses (agent_control_refused) a name outside the grammar: the app never
    sends one, so it is either an old app or something that is not the app.
    """
    if not isinstance(session, str) or not NAME.match(session):
        raise Refusal("agent_control_invalid")
    if session in SINGLETONS:
        return SINGLETONS[session], None, "agent"
    match = NUMBERED_RE.match(session)
    if match:
        return NUMBERED[match.group(1)], match.group(2), "agent"
    match = REVIEWER_RE.match(session)
    if match:
        return "critico", match.group(1), "reviewer"
    if session in NO_ACTIONS:
        return session.lower(), None, "scheduled"
    raise Refusal("agent_control_refused")


def _held(session: str):
    """None, or who holds the session contained ("user" for this panel's own hold)."""
    module = roster()
    if not module.is_contained(session):
        return None
    entry = module.load()["agents"].get(session) or {}
    by = entry.get("contained_by")
    if not by:
        try:
            by = json.loads(module.containment_marker(session).read_text(encoding="utf-8")).get("by")
        except (OSError, ValueError, AttributeError):
            by = None
    return by or "unknown"


def _held_by_user(session: str) -> bool:
    by = _held(session)
    return by == USER


# ── gates before a start ────────────────────────────────────────────────────
def _closer_consented() -> bool:
    # Fail closed, as start-agent.sh does: a gate that cannot answer answers no.
    if not APPLY_GATE.exists():
        return False
    try:
        return subprocess.run([sys.executable, str(APPLY_GATE), "consent"],
                              capture_output=True, timeout=15).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _disk_low() -> bool:
    # Same reading as start-agent.sh (jht_spawn_disk_guard): only rc 3 refuses;
    # a guard that cannot measure is not a second way of not starting.
    if not HOST_VITALS.exists():
        return False
    try:
        return subprocess.run([sys.executable, str(HOST_VITALS), "disk-guard"],
                              capture_output=True, timeout=10).returncode == 3
    except (OSError, subprocess.TimeoutExpired):
        return False


def _paused() -> bool:
    try:
        return standby().status().get("state") == "active"
    except Exception:  # noqa: BLE001 - a standby that cannot be read is not a pause
        return False


def _start_gates(role: str, instance: str | None) -> None:
    # A team in standby spends nothing, on purpose: starting one agent would
    # end that silently. The user resumes the team first. A team the user
    # stopped (.team-halted.flag) is different: like `jht team start <agent>`,
    # the one agent starts, and the watchdog still respawns nobody.
    if _paused():
        raise Refusal("team_paused")
    if role == "closer" and not _closer_consented():
        raise Refusal("closer_not_consented")
    if _disk_low():
        raise Refusal("disk_low")


def _spawn(session: str, role: str, instance: str | None) -> None:
    argv = ["bash", str(START_AGENT), role] + ([instance] if instance else [])
    env = {**os.environ, "JHT_SPAWN_SRC": SPAWN_SRC}
    try:
        subprocess.run(argv, capture_output=True, timeout=START_TIMEOUT_S, env=env)
    except (OSError, subprocess.TimeoutExpired):
        pass
    if not alive(session):
        raise Refusal("agent_start_failed")


# ── the actions ─────────────────────────────────────────────────────────────
def start(session: str) -> str:
    role, instance, kind = parse_session(session)
    if kind != "agent":
        raise Refusal("agent_control_refused")
    module = roster()
    if instance not in (None, "1") and session not in module.load()["agents"]:
        # Scaling the team up is the captain's: the panel brings back the
        # instances the team already has, and the first one.
        raise Refusal("agent_control_refused")
    if role == "closer" and instance != "1":
        raise Refusal("agent_control_refused")
    holder = _held(session)
    if holder is not None and holder != USER:
        raise Refusal("agent_contained")
    if alive(session):
        if holder == USER:
            module.release(session, USER, USER_START_REASON)
        return "already_running"
    _start_gates(role, instance)
    if holder == USER:
        module.release(session, USER, USER_START_REASON)
    _spawn(session, role, instance)
    return "started"


def stop(session: str) -> str:
    role, instance, kind = parse_session(session)
    if kind == "scheduled":
        raise Refusal("agent_control_refused")
    was_alive = alive(session)
    if kind == "agent":
        module = roster()
        holder = _held(session)
        if holder is None:
            # The hold first: if it cannot be written, nothing is killed (a
            # stop that does not hold would come back in 30 s, and say it
            # had worked).
            try:
                if session not in module.load()["agents"]:
                    module.record(role, instance, src=SPAWN_SRC)
                module.contain(session, USER, USER_STOP_REASON, SPAWN_SRC)
            except (OSError, ValueError, KeyError):
                raise Refusal("agent_stop_failed")
        # A hold already there (the user's, or a safety one) stays as it is.
    if not _kill(session):
        raise Refusal("agent_stop_failed")
    return "stopped" if was_alive else "already_stopped"


def restart(session: str) -> str:
    role, instance, kind = parse_session(session)
    if kind != "agent":
        raise Refusal("agent_control_refused")
    if not alive(session) or _held(session) is not None:
        raise Refusal("agent_not_running")
    _start_gates(role, instance)
    if not _kill(session):
        raise Refusal("agent_stop_failed")
    _spawn(session, role, instance)
    return "restarted"


def _halted() -> bool:
    return (jht_home() / ".team-halted.flag").exists()


def pause(for_hours: int | None, until: str | None, weekly: bool, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    target = None
    if for_hours is not None:
        if not 1 <= for_hours <= 168:
            raise Refusal("agent_control_invalid")
        target = now + timedelta(hours=for_hours)
    elif until is not None:
        try:
            target = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise Refusal("agent_control_invalid")
        if target.tzinfo is None:
            raise Refusal("agent_control_invalid")
        if not now < target <= now + MAX_PAUSE:
            raise Refusal("agent_control_invalid")
    elif not weekly:
        raise Refusal("agent_control_invalid")
    module = standby()
    if module.status().get("state") == "active":
        return "already_paused"
    try:
        module.activate(reason=PAUSE_REASON,
                        until=target.isoformat(timespec="seconds") if target else None,
                        wake_on_weekly=module.DEFAULT_WEEKLY_BELOW if weekly else None,
                        by=USER)
    except Exception:  # noqa: BLE001 - any failure is the same answer
        raise Refusal("team_pause_failed")
    return "paused"


def resume() -> str:
    # The user's stop wins: leaving standby would not start a stopped team,
    # and «resumed» would be false. Nothing is changed.
    if _halted():
        raise Refusal("team_halted")
    module = standby()
    if module.status().get("state") == "off":
        return "not_paused"
    try:
        result = module.wake(why=RESUME_REASON)
    except Exception:  # noqa: BLE001
        raise Refusal("team_resume_failed")
    return "resumed" if result.get("removed") else "not_paused"


@contextlib.contextmanager
def _one_at_a_time():
    """One action on the team at a time; a second one is told, not queued."""
    if fcntl is None:
        yield
        return
    path = jht_home() / "locks" / "agent-control.lock"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a")
    except OSError:
        raise Refusal("agent_control_busy")
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Refusal("agent_control_busy")
        yield
    finally:
        handle.close()


# ── the reads (also the read-only view's) ──────────────────────────────────
def _sessions() -> dict | None:
    try:
        done = _tmux("list-sessions", "-F", "#{session_name}\t#{session_created}\t#{session_activity}")
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        if "no server running" in done.stderr or "error connecting to" in done.stderr:
            return {}
        return None
    out = {}
    for line in done.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or not NAME.match(parts[0]):
            continue
        try:
            out[parts[0]] = (int(parts[1]), int(parts[2]))
        except ValueError:
            continue
    return out


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _text(value):
    return value if isinstance(value, str) and len(value) <= 40 else None


def read_list() -> dict:
    live = _sessions()
    if live is None:
        return {"ok": False, "error": "agents_unavailable"}
    states = None
    try:
        done = subprocess.run([sys.executable, str(AGENT_STATE)], capture_output=True, text=True, timeout=10)
        if done.returncode == 0:
            value = json.loads(done.stdout)
            if isinstance(value, dict):
                states = value
    except Exception:  # noqa: BLE001 - no state is «unknown», never an error
        states = None
    items = []
    for name in sorted(live)[:200]:
        created, activity = live[name]
        known = states.get(name.lower()) if states is not None else None
        known = known if isinstance(known, dict) else {}
        items.append({"name": name, "created": created, "activity": activity,
                      "state": _text(known.get("state")), "reason": _text(known.get("reason")),
                      "since": _number(known.get("since")), "until": _number(known.get("until"))})
    return {"ok": True, "data": {"items": items, "states": states is not None}}


ESCAPES = re.compile(r"\x1b(\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(\x07|\x1b\\)?|[@-Z\\-_])")


def read_screen(name) -> dict:
    if not isinstance(name, str) or not NAME.match(name):
        return {"ok": False, "error": "agents_unavailable"}
    live = _sessions()
    if live is None:
        return {"ok": False, "error": "agents_unavailable"}
    if name not in live:
        return {"ok": True, "data": {"name": name, "up": False, "text": None}}
    try:
        done = subprocess.run(["tmux", "capture-pane", "-p", "-J", "-t", "=" + name + ":", "-S", "-60"],
                              capture_output=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return {"ok": False, "error": "agents_unavailable"}
    if done.returncode != 0:
        return {"ok": False, "error": "agents_unavailable"}
    raw = ESCAPES.sub("", done.stdout.decode("utf-8", "replace"))
    raw = "".join(ch for ch in raw if ch in "\n\t" or (ord(ch) >= 32 and not 127 <= ord(ch) < 160))
    # Fail closed: without the shared list of invisible characters, or without
    # the redactor, no terminal is shown.
    try:
        sys.path.insert(0, str(SKILLS))
        sys.path.insert(1, str(HERE))
        from external_content import INVISIBLE_COMMANDS
    except Exception:  # noqa: BLE001
        return {"ok": False, "error": "agent_screen_unfiltered"}
    raw = "".join(ch for ch in raw if ch not in INVISIBLE_COMMANDS)
    try:
        done = subprocess.run(["node", str(REDACTOR), "--secrets"], input=raw.encode("utf-8"),
                              capture_output=True, timeout=4)
    except (OSError, subprocess.TimeoutExpired):
        return {"ok": False, "error": "agent_screen_unfiltered"}
    if done.returncode != 0:
        return {"ok": False, "error": "agent_screen_unfiltered"}
    raw = done.stdout.decode("utf-8", "replace")
    raw = "\n".join(raw.rstrip("\n").split("\n")[-60:])
    data = raw.encode("utf-8")
    if len(data) > 16384:
        raw = data[-16384:].decode("utf-8", "ignore")
    return {"ok": True, "data": {"name": name, "up": True, "text": raw}}


def read_team() -> dict:
    """The team's own state for the panel's header: stopped, paused, and the holds."""
    try:
        state = standby().status()
    except Exception:  # noqa: BLE001
        state = {"state": "unknown"}
    held = []
    try:
        module = roster()
        marker_dir = module.containment_marker("X").parent
        for marker in sorted(marker_dir.glob("*.hold.json"))[:200]:
            session = marker.name.removesuffix(".hold.json")
            if NAME.match(session):
                held.append({"session": session, "by_user": _held(session) == USER})
    except Exception:  # noqa: BLE001
        held = None
    wake_on = state.get("wake_on") if isinstance(state.get("wake_on"), dict) else None
    return {"ok": True, "data": {
        "halted": _halted(),
        "standby": {"state": _text(state.get("state")) or "unknown",
                    "until": _text(state.get("until")),
                    "weekly_reset": bool(wake_on and wake_on.get("weekly_below") is not None)},
        "held": held,
    }}


READS = {"list": lambda req: read_list(),
         "screen": lambda req: read_screen(req.get("name")),
         "team": lambda req: read_team()}


def from_stdin() -> int:
    """The read-only channel: one JSON request, reads only, always exit 0."""
    try:
        request = json.loads(sys.stdin.readline())
    except Exception:  # noqa: BLE001
        request = None
    op = request.get("op") if isinstance(request, dict) else None
    _emit(READS[op](request) if op in READS else {"ok": False, "error": "agents_unavailable"})
    return 0


# ── the command line ────────────────────────────────────────────────────────
class _Parser(argparse.ArgumentParser):
    # argparse exits 2 on a bad argument; 2 here means «this file is missing»
    # (an older image), so a bad request has its own code.
    def error(self, message):  # noqa: D401
        raise Refusal("agent_control_invalid")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="agent_control.py", add_help=False)
    sub = parser.add_subparsers(dest="op", required=True, parser_class=_Parser)
    for op in ("start", "stop", "restart", "screen"):
        sub.add_parser(op, add_help=False).add_argument("session")
    pause_parser = sub.add_parser("pause", add_help=False)
    exit_condition = pause_parser.add_mutually_exclusive_group(required=True)
    exit_condition.add_argument("--for-hours", type=int)
    exit_condition.add_argument("--until")
    exit_condition.add_argument("--wake-on-weekly", action="store_true")
    for op in ("resume", "list", "team"):
        sub.add_parser(op, add_help=False)
    return parser


ACTIONS = {"start", "stop", "restart", "pause", "resume"}


def main(argv: list[str]) -> int:
    if not argv:
        return from_stdin()
    op = argv[0] if argv[0] in ACTIONS | set(READS) else None
    session = None
    try:
        args = _parser().parse_args(argv)
        op = args.op
        session = getattr(args, "session", None)
        if op == "list":
            _emit(read_list())
            return 0
        if op == "screen":
            _emit(read_screen(session))
            return 0
        if op == "team":
            _emit(read_team())
            return 0
        with _one_at_a_time():
            if op == "start":
                result = start(session)
            elif op == "stop":
                result = stop(session)
            elif op == "restart":
                result = restart(session)
            elif op == "pause":
                result = pause(args.for_hours, args.until, args.wake_on_weekly)
            else:
                result = resume()
    except Refusal as refusal:
        # Only a name of the grammar is echoed or journaled: a refused request
        # may carry anything.
        session = session if isinstance(session, str) and NAME.match(session) else None
        answer = {"ok": False, "op": op, "session": session, "error": refusal.code}
        _emit(answer)
        if op in ACTIONS:
            _journal({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **answer})
        return EXIT[refusal.code]
    answer = {"ok": True, "op": op, "session": session, "result": result}
    _emit(answer)
    _journal({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **answer})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
