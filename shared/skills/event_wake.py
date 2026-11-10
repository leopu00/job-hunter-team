#!/usr/bin/env python3
"""event_wake.py - wake an IDLE Analista or Scorer when a position reaches their queue (JHT-T297).

The hand-off between roles is the database: a Scout's INSERT (`status=new`) is found by an
Analista through `next-for-analista`, and the Analista's `checked` is found by a Scorer through
`next-for-scorer`. That stays true. What was missing is the case where nobody is looking: an
Analista that drained the queue and ended its turn sits at the prompt, and a position inserted
afterwards waits for the next throttle or the next watchdog round, with the Scorers starved
behind it: Analisti can stay idle while positions `new` pile up in the queue.

So the writers (`db_insert.py position`, `db_update.py position --status ...`) call `notify()`
after their commit. It is cheap and never raises: it looks for tmux sessions of the role and, only
if there are some, starts `wake` in a detached process, so the Scout never waits for it.

`wake` wakes ONE agent of the role per event, and only when all of these hold:
  - the team is not stopped (`.team-halted.flag`, `.weekly-halt.flag`) nor in standby;
  - the role's queue is not empty (the event may have been served already);
  - the spend brake is not holding (recovery after a freeze, team over its pace; the user's burn lifts it);
  - the agent is not paused (`agent_pause`);
  - fewer than HOURLY_CAP wakes were sent for the role in the last hour (the valve);
  - and the agent is waiting, in one of two ways:
      in a THROTTLE (the common case: the 9 minutes of a throttle with work waiting): its deadline
        is brought forward to now (`pull_forward`), and the engine's next tick wakes it
        as at expiry, with the same gates. Refused while the pause is a brake on the spend (recovery
        after a freeze, team over its pace; the user's burn lifts it);
      IDLE at its prompt, no throttle (it drained the queue and ended its turn): the agent's own logs
        say `idle` (`agent_state.derive`) and it gets a one-line message. Not woken again since it last
        finished a turn, unless the wake went unanswered for RETRY_SEC: a wake is never a loop.
The writers are not the only ones that look: the throttle engine's tick runs `sweep` every SWEEP_SEC. A wake that waits for an
INSERT leaves an Analista idle for good once the Scouts have stopped inserting (the burst of 10/11: Analista-6 ended its turn at
minute 19.5 with 20 positions `new` and nothing wrote to the queue again), and a position that an Analista leaves `checked`
wakes only a Scorer. The sweep asks the same question as a writer would (same gates, same message, never twice for the same
idle turn) and logs only when it wakes someone.

A busy agent is not woken: it reads the queue by itself when it ends the unit. The message is a
signal, not an order about one position.

Every decision is one line of `logs/event-wakes.jsonl`, woken or not, with the reason.

Uso:
  python3 event_wake.py wake --role analista|scorer
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - the team runs on Linux
    fcntl = None

HERE = Path(__file__).resolve().parent

# The position state that lands in a role's queue -> the role to wake.
STATE_TO_ROLE = {"new": "analista", "checked": "scorer"}
QUEUE_COMMAND = {"analista": "next-for-analista", "scorer": "next-for-scorer"}
RETRY_SEC = 300
EARLY_MIN_LEFT_SEC = 15  # less than the engine tick plus a margin: the timer is about to fire anyway
HOURLY_CAP = 60
HALT_FLAGS = (".team-halted.flag", ".weekly-halt.flag")
DISABLE_ENV = "JHT_EVENT_WAKE"  # "0" turns the wake off
DEBOUNCE_SEC = 5  # a burst of inserts starts one wake per role, not one process per position
SWEEP_SEC = 45  # the engine's tick asks for an idle Analista or Scorer at most this often (see `sweep`)


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _log(row: dict, home: Path) -> None:
    try:
        path = home / "logs" / "event-wakes.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as out:
            out.write(json.dumps(row, separators=(",", ":"), ensure_ascii=False) + "\n")
    except OSError:
        pass


def sessions_of(role: str, runner=subprocess.run) -> dict[str, float]:
    """{real tmux session name: created epoch} of the sessions that are agents of `role`."""
    try:
        out = runner(["tmux", "list-sessions", "-F", "#{session_name}\t#{session_created}"],
                     capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    pattern = re.compile(rf"^{re.escape(role)}-\d+$", re.IGNORECASE)
    found = {}
    for line in (out or "").splitlines():
        name, _, created = line.partition("\t")
        try:
            if pattern.match(name.strip()):
                found[name.strip()] = float(created)
        except ValueError:
            continue
    return found


def _debounced(role: str, home: Path) -> bool:
    """True when a wake for `role` started in the last DEBOUNCE_SEC seconds (each writer is its own process, so the
    memory is a stamp file). The stamp is taken here; a folder that cannot be written means no debounce."""
    stamp = home / "logs" / f".event-wake-{role}.stamp"
    try:
        if time.time() - stamp.stat().st_mtime < DEBOUNCE_SEC:
            return True
    except OSError:
        pass
    try:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text("", encoding="utf-8")
    except OSError:
        pass
    return False


def notify(to_state, spawn=None, sessions=None, environ=None, home=None) -> bool:
    """Called by the writers after their commit. True if a wake was started. Never raises."""
    try:
        role = STATE_TO_ROLE.get(to_state)
        env = os.environ if environ is None else environ
        if role is None or env.get(DISABLE_ENV) == "0" or not (sessions or sessions_of)(role):
            return False
        if _debounced(role, home or _home()):
            return False
        (spawn or _spawn)(role)
        return True
    except Exception:  # noqa: BLE001 - a writer must never fail because of a wake
        return False


def _spawn(role: str) -> None:
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "wake", "--role", role],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True)


def blocked_reason(home: Path, now: float) -> str | None:
    if any((home / flag).exists() for flag in HALT_FLAGS):
        return "team_halted"
    try:
        sys.path.insert(0, str(HERE))
        import standby
        if standby.is_active(home=home):
            return "standby"
    except Exception:  # noqa: BLE001 - an unreadable standby is no standby
        pass
    finally:
        if str(HERE) in sys.path:
            sys.path.remove(str(HERE))
    return None


def queue_count(role: str, for_agent: str | None = None) -> int:
    """Positions waiting for `role` (for_agent: those that agent may take, leaving out what a colleague holds);
    0 if the database cannot be read (no wake without a certain read)."""
    try:
        sys.path.insert(0, str(HERE))
        import db_query
        conn = db_query.get_db()
        try:
            return int(db_query.role_queue_count(conn, role, for_agent=for_agent))
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return 0
    finally:
        if str(HERE) in sys.path:
            sys.path.remove(str(HERE))


def state_of(uid: str, created: float, now: float, home: Path) -> dict:
    sys.path.insert(0, str(HERE))
    try:
        import agent_state
        return agent_state.derive(uid, home, created, now)
    finally:
        if str(HERE) in sys.path:
            sys.path.remove(str(HERE))


def is_paused(session: str, home: Path) -> bool:
    try:
        sys.path.insert(0, str(HERE))
        import agent_pause
        return bool(agent_pause.is_paused(session, home=home))
    except Exception:  # noqa: BLE001
        return False
    finally:
        if str(HERE) in sys.path:
            sys.path.remove(str(HERE))


def send_text(session: str, text: str) -> bool:
    binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"
    try:
        return subprocess.run([binary, session, text], capture_output=True, timeout=120).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def message(role: str, uid: str, waiting: int) -> str:
    what = "new position(s) wait for analysis" if role == "analista" else "analysed position(s) wait for a score"
    return (f"[@system -> @{uid}] [WAKE] {waiting} {what} in your queue. "
            f"Run `python3 /app/shared/skills/db_query.py {QUEUE_COMMAND[role]}` and continue your loop. "
            "This is a signal, not an order about one position: no reply, no ACK.")


class Ledger:
    """Who was woken and when, under a file lock: two writers must not wake the same agent twice."""

    def __init__(self, home: Path):
        self.path = home / "state" / "event-wakes.json"
        self.lock = home / "state" / "event-wakes.lock"

    def __enter__(self):
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(self.lock, os.O_CREAT | os.O_RDWR, 0o600)
        if fcntl:
            fcntl.flock(self._fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        os.close(self._fd)

    def read(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {"agents": data.get("agents") or {}, "sent": data.get("sent") or {}}
        except (OSError, ValueError):
            pass
        return {"agents": {}, "sent": {}}

    def write(self, data: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, self.path)


def _engine():
    sys.path.insert(0, str(HERE))
    try:
        import throttle_engine
        return throttle_engine
    finally:
        if str(HERE) in sys.path:
            sys.path.remove(str(HERE))


def pull_forward(agent: str, now: float, engine=None) -> dict:
    """Bring the deadline of an agent IN_THROTTLE to now; the engine's next tick wakes it as at expiry.

    It wakes nobody by itself: the tick does what it does at every expiry, with the same gates (agent paused,
    halts, daily halt) and the same delivery with its retries, so the timed wake and the event wake are ONE and
    an agent never gets two messages. It refuses, and says why, when the pause is a brake and not an empty wait:
    recovery after a freeze or team over its pace (`captains_pause_stays`; the user's burn lifts it), and the
    daily-halt timer, which is not a pacing decision."""
    engine = engine or _engine()
    agent = str(agent or "").strip().lower()
    with engine._flags_lock():
        state = engine.read_flags()
        entry = state["agents"].get(agent)
        if not isinstance(entry, dict) or entry.get("state") != engine.IN_THROTTLE:
            return {"agent": agent, "pulled": False, "reason": "not_in_throttle"}
        until = entry.get("until")
        if not isinstance(until, (int, float)) or until <= now:
            return {"agent": agent, "pulled": False, "reason": "already_due"}
        if entry.get("reason") == "daily-halt":
            return {"agent": agent, "pulled": False, "reason": "daily_halt"}
        stays = engine.captains_pause_stays(now)
        if stays is not None:
            engine.emit("woken_early_refused", agent=agent, ts=now, hold=stays)
            return {"agent": agent, "pulled": False, "reason": stays}
        entry["until"] = int(now)
        engine.write_flags(state)
        engine.emit("woken_early", agent=agent, ts=now, left_sec=int(until - now))
    return {"agent": agent, "pulled": True, "left_sec": int(until - now)}


def _eligible(now, home, found, ledger_data, paused, derive, flag_of):
    """[(waiting since, kind, uid, session)]: who may be woken now, the longest waiting first.

    kind is "throttle" (deadline brought forward) or "idle" (message)."""
    out = []
    for session, created in found.items():
        uid = session.lower()
        if paused(session, home):
            continue
        flag = flag_of(uid) or {}
        if flag.get("state") == "IN_THROTTLE":
            until = flag.get("until")
            if isinstance(until, (int, float)) and until - now > EARLY_MIN_LEFT_SEC:
                out.append((float(flag.get("since") or 0), "throttle", uid, session))
            continue
        if flag.get("state") == "NOTIFIED":
            continue  # the engine has just woken it: it is about to work
        verdict = derive(uid, created, now, home)
        if verdict.get("state") != "idle":
            continue
        since = float(verdict.get("since") or 0)
        woke = (ledger_data["agents"].get(uid) or {}).get("woke_at")
        if isinstance(woke, (int, float)) and woke >= since and now - woke < RETRY_SEC:
            continue
        out.append((since, "idle", uid, session))
    return sorted(out)


def wake(role, now=None, home=None, queue=None, sessions=None, derive=None, paused=None, send=None,
         blocked=None, flag_of=None, pull=None, hold=None, sweep=False, queue_for=None) -> dict:
    """Wake one waiting agent of `role` if the rules in the module doc allow it. Returns the decision.

    sweep: asked by the engine's tick and not by a writer; a decision that wakes nobody is not logged (it would be one
    line per role every SWEEP_SEC for the whole run)."""
    home = Path(home) if home is not None else _home()
    now = time.time() if now is None else float(now)
    queue, sessions, derive = queue or queue_count, sessions or sessions_of, derive or state_of
    paused, send, blocked = paused or is_paused, send or send_text, blocked or blocked_reason
    result = {"role": role, "woken": None, "why": None}

    def done(why, **extra):
        result.update(why=why, **extra)
        if not sweep or why in ("woken", "send_failed"):
            _log({"ts": int(now), **result}, home)
        return result

    if role not in QUEUE_COMMAND:
        return done("unknown_role")
    reason = blocked(home, now)
    if reason:
        return done(reason)
    waiting = queue(role)
    if waiting <= 0:
        return done("queue_empty")
    found = sessions(role)
    if not found:
        return done("no_session", waiting=waiting)
    engine = _engine() if None in (flag_of, pull, hold) else None
    flag_of, pull = flag_of or engine.get_flag, pull or (lambda uid, at: pull_forward(uid, at, engine))
    # The same hold that keeps the Capitano's pause: recovery after a freeze, team over its pace. The
    # user's burn lifts it. An agent woken by a message would otherwise spend what a throttle protects.
    stays = (hold or engine.captains_pause_stays)(now)
    if stays:
        return done("budget_hold", waiting=waiting, hold=stays)
    with Ledger(home) as ledger:
        data = ledger.read()
        recent = [t for t in data["sent"].get(role, []) if now - t < 3600]
        if len(recent) >= HOURLY_CAP:
            return done("hourly_cap", waiting=waiting)
        chosen = _eligible(now, home, found, data, paused, derive, flag_of)
        if not chosen:
            return done("nobody_waiting", waiting=waiting)
        _, kind, uid, session = chosen[0]
        # what is in the queue may all be in the hands of colleagues (queue_claims.py): waking this one would find nothing
        if kind == "idle" and (queue_for or (queue_count if queue is queue_count else None)) is not None:
            if (queue_for or queue_count)(role, uid) <= 0:
                return done("held_by_others", waiting=waiting)
        if kind == "throttle":
            pulled = pull(uid, now)
            if not pulled.get("pulled"):
                return done("throttle_kept", waiting=waiting, session=session, detail=pulled.get("reason"))
            data["sent"][role] = [*recent, now]
            ledger.write(data)
            return done("woken", woken=uid, waiting=waiting, via="throttle", left_sec=pulled.get("left_sec"))
        data["agents"][uid] = {"woke_at": now}
        data["sent"][role] = [*recent, now]
        ledger.write(data)
    if send(session, message(role, uid, waiting)):
        return done("woken", woken=uid, waiting=waiting, via="message")
    with Ledger(home) as ledger:  # not delivered: the reservation goes, the next event tries again
        data = ledger.read()
        data["agents"].pop(uid, None)
        data["sent"][role] = [t for t in data["sent"].get(role, []) if t != now]
        ledger.write(data)
    return done("send_failed", waiting=waiting, session=session)


def sweep(now=None, home=None, **fakes) -> list[dict]:
    """The engine's tick: ask for an idle Analista and an idle Scorer (the same `wake`, with its gates), at most every
    SWEEP_SEC. Never raises; [] when it is not time or the wake is off."""
    try:
        if os.environ.get(DISABLE_ENV) == "0":
            return []
        home = Path(home) if home is not None else _home()
        now = time.time() if now is None else float(now)
        stamp = home / "logs" / ".event-wake-sweep.stamp"
        try:
            if now - stamp.stat().st_mtime < SWEEP_SEC:
                return []
        except OSError:
            pass
        try:
            stamp.parent.mkdir(parents=True, exist_ok=True)
            stamp.write_text("", encoding="utf-8")
            os.utime(stamp, (now, now))
        except OSError:
            pass
        return [wake(role, now=now, home=home, sweep=True, **fakes) for role in sorted(QUEUE_COMMAND)]
    except Exception:  # noqa: BLE001 - a tick must never fail because of a wake
        return []


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="event_wake")
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("wake", help="wake one idle agent of the role, if the rules allow")
    w.add_argument("--role", required=True, choices=sorted(QUEUE_COMMAND))
    args = ap.parse_args(argv)
    print(json.dumps(wake(args.role), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
