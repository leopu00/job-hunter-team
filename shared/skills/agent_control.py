#!/usr/bin/env python3
"""The agents' control panel, container side: one place for every rule.

The desktop app reaches this file in two ways, and only these:

  * with arguments, for an action or a read (local team: the attested `jht`
    wrapper runs `jht agent-control ...`; a VPS team: a fixed
    `docker exec ... python3 /app/shared/skills/agent_control.py ...`):

        agent_control.py start|stop|restart SESSION
        agent_control.py pause (--for-hours N | --until ISO | --wake-on-weekly)
        agent_control.py resume
        agent_control.py list | screen SESSION | team | history
        agent_control.py exclusions | exclusion-accept CODE | exclusion-withdraw CODE
        agent_control.py answer QUESTION_ID OPTION_ID

  * without arguments, with one JSON request on stdin, for the reads only
    (`{"op":"list"}`, `{"op":"screen","name":...}`, `{"op":"team"}`,
    `{"op":"history"}`, `{"op":"exclusions"}`). This is
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
import sqlite3
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
    "exclusion_no_evidence": 115,
    "exclusion_failed": 116,
    "question_unknown": 117,
    "answer_refused": 118,
    "answer_failed": 119,
    "questions_unsupported": 120,
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
PROFILE_EXCLUSIONS = _first(SKILLS / "profile_exclusions.py", HERE / "profile_exclusions.py")
AGENT_QUESTIONS = _first(SKILLS / "agent_questions.py", HERE / "agent_questions.py")
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


def burn_intent():
    return _load("agent_control_burn_intent", "burn_intent.py")


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


# Who each agent is, as start-agent.sh wrote it on the agent's own session.
IDENTITY_CLI = frozenset({"claude", "codex", "kimi", "pi", "local"})
IDENTITY_EFFORT = frozenset({"low", "medium", "high"})
IDENTITY_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}\Z")


def _identity(cli: str, model: str, effort: str):
    out = {
        "cli": cli if cli in IDENTITY_CLI else None,
        "model": model if IDENTITY_MODEL.match(model) else None,
        "effort": effort if effort in IDENTITY_EFFORT else None,
    }
    return out if out["cli"] is not None else None


def _identities(names) -> dict:
    """cli, model and effort of the listed sessions, only to be shown.

    A call of its own, never folded into _sessions(): the three options live on
    the agent's own session, which may write anything in them, a newline or a
    tab included. Read together with the session list they could add sessions
    that do not exist or move the times of real ones. Here a line counts only
    with exactly four fields, for a session the real list has, and only when
    that session's name comes once (a made-up line for a real session makes it
    come twice: then it has no identity). Nothing decides on this field.
    """
    try:
        # short: tmux answers in milliseconds, and the read has its own ceiling (agent_control.rs)
        done = _tmux("list-sessions", "-F", "#{session_name}\t#{@jht-cli}\t#{@jht-model}\t#{@jht-effort}", timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if done.returncode != 0:
        return {}
    seen: dict = {}
    for line in done.stdout.splitlines():
        parts = line.split("\t")
        name = parts[0]
        if name not in names:
            continue
        seen[name] = None if name in seen or len(parts) != 4 else _identity(*parts[1:])
    return seen


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _text(value):
    return value if isinstance(value, str) and len(value) <= 40 else None


# role-usage.json is written by the sentinel bridge at each of its readings (every
# 5 min); older than this it is not the last hour any more, as the bridge reads it.
HOUR_USAGE_MAX_AGE_S = 15 * 60


def _hour_usage(now: float | None = None) -> tuple[dict, float] | None:
    """({agent: tokens of the last hour}, when counted) from the bridge's file,
    or None when it is missing, older than HOUR_USAGE_MAX_AGE_S or of an image
    that does not count per agent."""
    try:
        data = json.loads((jht_home() / "logs" / "role-usage.json").read_text(encoding="utf-8"))
        at = datetime.fromisoformat(str(data["generated_at"])).timestamp()
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None
    agents = data.get("agents_1h")
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    if not isinstance(agents, dict) or not -60 <= now - at <= HOUR_USAGE_MAX_AGE_S:
        return None
    return agents, at


def _usage(name: str, known: dict, hour: tuple[dict, float] | None) -> dict:
    """How full the agent's context is (agent_state.py) and its tokens of the
    last hour (the bridge). Each field None when it is not known: never 0."""
    context = known.get("context") if isinstance(known.get("context"), dict) else {}
    return {"context_pct": _number(context.get("pct")), "context_tokens": _number(context.get("tokens")),
            "context_window": _number(context.get("window")), "context_at": _number(context.get("at")),
            "tokens_1h": _number(hour[0].get(name.lower())) if hour else None,
            "tokens_at": hour[1] if hour else None}


def _questions(known: dict):
    """The questions the agent asked the user and its unread messages
    (agent_state.py), only to be shown: the app closes their shape again.
    None when not known (an older image, a jobs.db that cannot be read)."""
    value = known.get("questions")
    return value if isinstance(value, dict) else None


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
    identities = _identities(set(live))
    hour = _hour_usage()
    items = []
    for name in sorted(live)[:200]:
        created, activity = live[name]
        known = states.get(name.lower()) if states is not None else None
        known = known if isinstance(known, dict) else {}
        items.append({"name": name, "created": created, "activity": activity,
                      "state": _text(known.get("state")), "reason": _text(known.get("reason")),
                      "since": _number(known.get("since")), "until": _number(known.get("until")),
                      "identity": identities.get(name),
                      "usage": _usage(name, known, hour),
                      "questions": _questions(known)})
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
    # The user's full-throttle override (JHT-T33): on, with its end, or off; "expired" until the
    # bridge clears the flag. Read through the module that owns the flag, never from the file.
    burn = {"state": "unknown", "expires_at": None, "remaining_min": None}
    try:
        seen = burn_intent().status()
        remaining = seen.get("remaining_min")
        burn = {"state": seen["state"] if seen.get("state") in ("off", "active", "expired") else "unknown",
                "expires_at": _text(seen.get("expires_at")),
                "remaining_min": remaining if isinstance(remaining, int) and not isinstance(remaining, bool) else None}
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "data": {
        "halted": _halted(),
        "standby": {"state": _text(state.get("state")) or "unknown",
                    "until": _text(state.get("until")),
                    "weekly_reset": bool(wake_on and wake_on.get("weekly_below") is not None)},
        "held": held,
        "burn_intent": burn,
    }}


# ── the previous sessions of each agent (JHT-T43) ──────────────────────────
# Read from what the team already writes: the launcher's trace of every start (spawn-attempts.jsonl),
# the roster's holds and retirements, and this panel's own journal of what the person did. Nothing new
# is collected. A session starts at a start that completed; it ends at the first sign of an end between
# it and the next start, and a reason nobody wrote is «unknown», never a guess.
HISTORY_DAYS = 30
HISTORY_PER_AGENT = 20
HISTORY_FAILED_PER_AGENT = 5
# 100 agents of at most ~1.4 KB each stay far under the app's limit for one reply (256 KiB).
HISTORY_AGENTS = 100
HISTORY_TAIL_BYTES = 1024 * 1024
# The text a restart leaves in the journal is written after the new session is up: the start it explains
# is the one that follows within this many seconds.
RESTART_JOURNAL_SLACK_S = START_TIMEOUT_S + 30
HISTORY_REASONS = ("running", "restarted_by_user", "stopped_by_user", "contained", "retired", "started_again", "unknown")


def _epoch(value) -> int | None:
    """Seconds since the epoch of an ISO stamp, or None for anything else."""
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    seconds = int(when.timestamp())
    return seconds if 0 <= seconds <= 4_102_444_800 else None


def _jsonl_tail(path: Path, max_bytes: int) -> tuple[list[dict], bool]:
    """The objects of the last lines of a JSON-lines file, and whether the file is longer than what was read."""
    try:
        with path.open("rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - max_bytes))
            raw = handle.read()
    except OSError:
        return [], False
    cut = size > max_bytes
    lines = raw.decode("utf-8", "replace").split("\n")
    if cut:
        lines = lines[1:]  # the first line is most likely a piece
    out = []
    for line in lines:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            out.append(value)
    return out, cut


def _history_spawns(now: int) -> tuple[dict, dict, int | None]:
    """(starts, failed, since): the completed starts per session as (epoch, by the panel), the failed ones, and
    the oldest moment the trace is known from (None when the trace holds everything it ever had)."""
    rows, cut = _jsonl_tail(jht_home() / "logs" / "spawn-attempts.jsonl", HISTORY_TAIL_BYTES)
    horizon = now - HISTORY_DAYS * 86400
    starts: dict[str, list[tuple[int, bool]]] = {}
    failed: dict[str, list[int]] = {}
    oldest = None
    for row in rows:
        at, session = _epoch(row.get("timestamp")), row.get("session")
        if at is None or not isinstance(session, str) or not NAME.match(session):
            continue
        oldest = at if oldest is None else min(oldest, at)
        if at < horizon:
            continue
        rc, stage = row.get("rc"), row.get("stage")
        if not isinstance(rc, int) or isinstance(rc, bool):
            continue
        if rc == 0 and stage == "complete":
            starts.setdefault(session, []).append((at, row.get("source") == SPAWN_SRC))
        elif rc != 0 and stage != "already_active":
            failed.setdefault(session, []).append(at)
    return starts, failed, (oldest if cut else None)


def _history_journal() -> dict:
    """What the person did from this panel, per session: [(epoch, op)] for the stops and restarts that worked."""
    out: dict[str, list[tuple[int, str]]] = {}
    base = jht_home() / "logs" / "agent-control.jsonl"
    for path in (base.with_name(base.name + ".1"), base):
        rows, _ = _jsonl_tail(path, JOURNAL_MAX_BYTES)
        for row in rows:
            at, session, op = _epoch(row.get("at")), row.get("session"), row.get("op")
            if (at is None or row.get("ok") is not True or op not in ("stop", "restart")
                    or not isinstance(session, str) or not NAME.match(session)):
                continue
            if row.get("result") in ("stopped", "restarted"):
                out.setdefault(session, []).append((at, op))
    return out


def _history_marks(session: str, entry: dict) -> list[tuple[int, str]]:
    """The ends the roster wrote for a session: [(epoch, reason)]."""
    marks = []
    for event in entry.get("containment_history") or []:
        if isinstance(event, dict) and event.get("action") == "contained":
            at = _epoch(event.get("at"))
            if at is not None:
                marks.append((at, "stopped_by_user" if event.get("by") == USER else "contained"))
    retired = _epoch(entry.get("retired_at"))
    if retired is not None:
        marks.append((retired, "retired"))
    return marks


def history_sessions(starts, journal, marks, live: bool | None) -> list[dict]:
    """The sessions of one agent, newest first. `starts` is [(epoch, by_panel)], `journal` [(epoch, op)],
    `marks` [(epoch, reason)], `live` whether the session is up now (None: not known)."""
    starts = sorted(starts)
    out = []
    for index, (begin, _by_panel) in enumerate(starts):
        following = starts[index + 1] if index + 1 < len(starts) else None
        limit = following[0] if following else None
        within = lambda at: at >= begin and (limit is None or at < limit)  # noqa: E731
        ends = sorted([(at, "stopped_by_user") for at, op in journal if op == "stop" and within(at)]
                      + [(at, why) for at, why in marks if within(at)])
        if ends:
            end, reason = ends[0]
        elif following and following[1] and any(op == "restart" and abs(at - following[0]) <= RESTART_JOURNAL_SLACK_S
                                                for at, op in journal):
            end, reason = following[0], "restarted_by_user"
        elif following:
            end, reason = following[0], "started_again"
        elif live:
            end, reason = None, "running"
        else:
            end, reason = None, "unknown"
        out.append({"start": begin, "end": end, "reason": reason})
    return out[::-1][:HISTORY_PER_AGENT]


LANE_HOURS = 24
LANE_ROLES = frozenset(SINGLETONS.values()) | frozenset(NUMBERED.values()) | {"dottore", "mantenitore"}
_LANE_ROLE = re.compile(r"^[a-z]+")


def history_lanes(now: int) -> dict | None:
    """How many moves of positions each role made in each of the last 24 hours: {role: [24 counts]}, the
    first count being the last hour. From the transitions every move of a position already leaves in jobs.db
    (db_update.py is their only writer). None when the database cannot be read: «not known» is not zero."""
    db = Path(os.environ.get("JHT_DB") or (jht_home() / "jobs.db"))
    if not db.is_file():
        return None
    try:
        conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
        try:
            rows = conn.execute(
                "SELECT lower(by_agent), (? - CAST(strftime('%s', ts) AS INTEGER)) / 3600, count(*) "
                "FROM position_state_transitions WHERE ts >= datetime(?, 'unixepoch') "
                "AND CAST(strftime('%s', ts) AS INTEGER) <= ? GROUP BY 1, 2",
                (now, now - LANE_HOURS * 3600, now)).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return None
    lanes: dict[str, list[int]] = {}
    for actor, hour, count in rows:
        found = _LANE_ROLE.match(actor or "")
        role = found.group(0) if found else ""
        if role not in LANE_ROLES or not isinstance(hour, int) or not 0 <= hour < LANE_HOURS:
            continue
        lanes.setdefault(role, [0] * LANE_HOURS)[hour] += int(count)
    return lanes


def read_history(now: int | None = None) -> dict:
    """The previous sessions of every agent that has a trace, from the files the team already writes."""
    now = int(now if now is not None else datetime.now(timezone.utc).timestamp())
    starts, failed, since = _history_spawns(now)
    journal = _history_journal()
    live = _sessions()
    try:
        agents = roster().load().get("agents") or {}
    except Exception:  # noqa: BLE001 - no roster is «no holds known»
        agents = {}
    items = []
    for name in sorted(set(starts) | set(failed))[:HISTORY_AGENTS]:
        try:
            parse_session(name)
        except Refusal:
            continue
        entry = agents.get(name) if isinstance(agents.get(name), dict) else {}
        sessions = history_sessions(starts.get(name, []), journal.get(name, []), _history_marks(name, entry),
                                    None if live is None else name in live)
        items.append({"name": name, "sessions": sessions,
                      "failed": sorted(failed.get(name, []))[::-1][:HISTORY_FAILED_PER_AGENT]})
    return {"ok": True, "data": {"items": items, "since": since, "now": now, "lanes": history_lanes(now)}}


# ── the exclusions of the profile (JHT-T24-b) ──────────────────────────────
# The user's decision to exclude a kind of position, written straight in this team's jobs.db
# when the team has no cloud to carry it. profile_exclusions.py stays the only writer of the table
# (and refuses when an agent runs it): this panel only asks it, with a code of the closed vocabulary.
CODE = re.compile(r"^[a-z][a-z_]{0,31}$")
EXCLUSION_REFUSALS = {"code_invalid": "agent_control_invalid", "no_evidence": "exclusion_no_evidence",
                      "user_only": "agent_control_refused"}


def _exclusions_call(*args: str) -> dict | None:
    """The one JSON line profile_exclusions.py answers, or None when it cannot answer."""
    if not PROFILE_EXCLUSIONS.exists():
        return None
    try:
        done = subprocess.run([sys.executable, str(PROFILE_EXCLUSIONS), *args], capture_output=True, text=True,
                              timeout=20, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        reply = json.loads(done.stdout.strip().splitlines()[-1])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None
    return reply if isinstance(reply, dict) else None


def read_exclusions() -> dict:
    """The exclusions in force or withdrawn, and the user's judgements the proposals are made of."""
    listed, events = _exclusions_call("list"), _exclusions_call("events")
    if not listed or not events or not listed.get("ok") or not events.get("ok"):
        return {"ok": False, "error": "exclusions_unavailable"}
    return {"ok": True,
            "exclusions": [{"code": row.get("code"), "status": row.get("status"), "decided_at": row.get("decided_at")}
                           for row in listed.get("exclusions", [])],
            "feedback": events.get("feedback", [])}


def exclusion_action(op: str, code: str) -> str:
    if not CODE.match(code or ""):
        raise Refusal("agent_control_invalid")
    reply = _exclusions_call("accept" if op == "exclusion-accept" else "withdraw", code)
    if reply is None:
        raise Refusal("exclusion_failed")
    if not reply.get("ok"):
        raise Refusal(EXCLUSION_REFUSALS.get(reply.get("code"), "exclusion_failed"))
    return "excluded" if op == "exclusion-accept" else "exclusion_withdrawn"


# ── the answer to an agent's question (JHT-T38) ────────────────────────────
# One option of a structured question, by the ids agent_questions.py gave them: never text.
# agent_questions.record_answer stays the only writer of an answer, and checks that the option
# is the question's, that the first answer wins and that an expired question takes its default.
# The channel is this file's, not the request's.
QUESTION_ID = re.compile(r"^aq:[a-z0-9][a-z0-9_-]{0,39}:[0-9]{1,20}-[a-z0-9]{1,16}\Z")
OPTION_ID = re.compile(r"^(?:_rinvia|[a-z0-9][a-z0-9_]{0,23})\Z")
ANSWER_CHANNEL = "desktop"
ANSWER_RESULTS = {"recorded": "answered", "already_answered": "already_answered", "expired": "expired"}
UNKNOWN_QUESTION = {"question_invalid", "question_unknown"}


def _agent_questions():
    """agent_questions.py of the image, or None (an image older than the questions)."""
    if not AGENT_QUESTIONS.exists():
        return None
    try:
        spec = importlib.util.spec_from_file_location("agent_control_questions", AGENT_QUESTIONS)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module  # its dataclasses look themselves up there
        spec.loader.exec_module(module)
        return module
    except Exception:  # noqa: BLE001 - a module that does not load is a module that is not there
        sys.modules.pop("agent_control_questions", None)
        return None


def answer_question(question: str, choice: str) -> str:
    if not QUESTION_ID.match(question or "") or not OPTION_ID.match(choice or ""):
        raise Refusal("agent_control_invalid")
    aq = _agent_questions()
    if aq is None:
        raise Refusal("questions_unsupported")
    db = Path(os.environ.get("JHT_DB") or (jht_home() / "jobs.db"))
    if not db.is_file():
        raise Refusal("answer_failed")
    try:
        conn = sqlite3.connect(str(db), timeout=5)
        try:
            done = aq.record_answer(conn, question, [choice], canale=ANSWER_CHANNEL)
        finally:
            conn.close()
    except aq.AnswerRejected as rejected:
        raise Refusal("question_unknown" if rejected.code in UNKNOWN_QUESTION else "answer_refused") from None
    except sqlite3.Error:
        raise Refusal("answer_failed") from None
    return ANSWER_RESULTS.get(done.status) or "answered"


READS = {"exclusions": lambda req: read_exclusions(),
         "list": lambda req: read_list(),
         "screen": lambda req: read_screen(req.get("name")),
         "team": lambda req: read_team(),
         "history": lambda req: read_history()}


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
    for op in ("resume", "list", "team", "history", "exclusions"):
        sub.add_parser(op, add_help=False)
    for op in ("exclusion-accept", "exclusion-withdraw"):
        sub.add_parser(op, add_help=False).add_argument("code")
    answer_parser = sub.add_parser("answer", add_help=False)
    answer_parser.add_argument("question")
    answer_parser.add_argument("choice")
    return parser


ACTIONS = {"start", "stop", "restart", "pause", "resume", "exclusion-accept", "exclusion-withdraw", "answer"}


def _answer_ids(question, choice) -> dict:
    """What the reply and the journal say of an answer: the ids, when they have their shape.
    Never the question's subject, text or labels: those are the agent's words, and may be the person's data."""
    out = {}
    if isinstance(question, str) and QUESTION_ID.match(question):
        out["question"] = question
    if isinstance(choice, str) and OPTION_ID.match(choice):
        out["choice"] = choice
    return out


def main(argv: list[str]) -> int:
    if not argv:
        return from_stdin()
    op = argv[0] if argv[0] in ACTIONS | set(READS) else None
    session = code = question = choice = None
    try:
        args = _parser().parse_args(argv)
        op = args.op
        session = getattr(args, "session", None)
        code = getattr(args, "code", None)
        question = getattr(args, "question", None)
        choice = getattr(args, "choice", None)
        if op == "exclusions":
            _emit(read_exclusions())
            return 0
        if op == "list":
            _emit(read_list())
            return 0
        if op == "screen":
            _emit(read_screen(session))
            return 0
        if op == "team":
            _emit(read_team())
            return 0
        if op == "history":
            _emit(read_history())
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
            elif op in ("exclusion-accept", "exclusion-withdraw"):
                result = exclusion_action(op, args.code)
            elif op == "answer":
                result = answer_question(args.question, args.choice)
            else:
                result = resume()
    except Refusal as refusal:
        # Only a name of the grammar is echoed or journaled: a refused request
        # may carry anything.
        session = session if isinstance(session, str) and NAME.match(session) else None
        answer = {"ok": False, "op": op, "session": session, "error": refusal.code}
        if isinstance(code, str) and CODE.match(code):
            answer["code"] = code
        answer.update(_answer_ids(question, choice))
        _emit(answer)
        if op in ACTIONS:
            _journal({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **answer})
        return EXIT[refusal.code]
    answer = {"ok": True, "op": op, "session": session, "result": result}
    if isinstance(code, str):
        answer["code"] = code
    answer.update(_answer_ids(question, choice))
    _emit(answer)
    _journal({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **answer})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
