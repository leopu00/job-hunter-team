"""One officially admitted Closer mission, with a host-CLI review confirmation.

The local CLI has the existing user_local trust boundary. Mission/owner/review
identifiers correlate operations; they do NOT authenticate a person or #279.
The slot survives termination and blocks the ordinary queue, including respawn.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import functools
from pathlib import Path
import secrets
import sqlite3
import sys
import time

try:
    from apply_session_lock import position_lock
except ImportError:
    from shared.skills.apply_session_lock import position_lock


class InteractiveDenied(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def home_path(home=None):
    return Path(home or os.environ.get("JHT_HOME") or Path.home() / ".jht")


def work_lock(home, owner=None):
    # Position zero is reserved for the global Closer admission barrier.
    # Flow positions are strictly positive. Explicit owner supports nesting.
    return position_lock(home_path(home), 0, owner=owner)


def _path(home=None):
    return home_path(home) / ".cache" / "closer-interactive" / "mission.json"


def read(home=None):
    path = _path(home)
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise InteractiveDenied("interactive_state_unreadable") from exc
    try:
        import stat
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise InteractiveDenied("interactive_state_unsafe")
            raw = stream.read(16385)
            if len(raw) > 16384:
                raise ValueError()
            value = json.loads(raw)
        if (not isinstance(value, dict) or value.get("version") != 1 or
                type(value.get("position_id")) is not int or value["position_id"] <= 0 or
                not identifier(value.get("mission_id")) or
                value.get("phase") not in PHASES or
                (value.get("owner_id") is not None and not identifier(value["owner_id"])) or
                (value.get("review_id") is not None and not identifier(value["review_id"]))):
            raise ValueError()
        return value
    except (ValueError, OSError) as exc:
        raise InteractiveDenied("interactive_state_unreadable") from exc


def _write(value, home=None):
    path = _path(home)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.is_symlink() or path.parent.stat().st_uid != os.getuid():
        raise InteractiveDenied("interactive_directory_unsafe")
    tmp = path.with_name(".mission-" + secrets.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        tmp.unlink(missing_ok=True)


@contextlib.contextmanager
def state_lock(home=None):
    # Separate from the work lock: the official host CLI can confirm while
    # the browser owner retains the global work/position/profile locks.
    from apply_session_lock import SessionBusy
    deadline = time.monotonic() + 2
    with contextlib.ExitStack() as stack:
        while True:
            try:
                stack.enter_context(position_lock(home_path(home), -1, owner=None))
                break
            except SessionBusy:
                if time.monotonic() >= deadline:
                    raise InteractiveDenied("interactive_state_busy")
                time.sleep(0.01)
        yield


def guard(home=None, position_id=None, interactive_owner=None):
    try:
        value = read(home)
    except InteractiveDenied as exc:
        return exc.reason
    if value is None:
        return "" if interactive_owner is None else "interactive_mission_missing"
    if (interactive_owner is not None and tuple(interactive_owner) ==
            (value.get("mission_id"), value.get("owner_id")) and
            position_id == value["position_id"] and value.get("phase") in
            {"running", "review_wait", "handoff_pending", "handoff", "confirmed", "observing"} and
            value.get("owner_pid") == os.getpid()):
        return ""
    return "interactive_mission_reserved"


PHASES = {"admitted", "running", "review_wait", "confirmed", "handoff_pending",
          "handoff", "observing", "completed", "closed", "unknown"}


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{32}", value) is not None


def ordinary_wake(function):
    """Keep admission and an ordinary wake mutually exclusive through delivery."""
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        from apply_session_lock import SessionBusy
        try:
            with work_lock(None):
                if guard():
                    return []
                return function(*args, **kwargs)
        except SessionBusy:
            return []
    return wrapped


def admit(position_id, *, conn=None, home=None):
    """Official local command. Reserve before the existing flag writer; never wake.

    A failed/uncertain commit leaves a blocking slot, never ordinary work.
    Existing checkpoint holds are checked against the OLD authorisation;
    admission is not an implicit reauthorisation of a held/unknown submit.
    """
    import apply_gate as gate
    import apply_request
    import _db

    if type(position_id) is not int or position_id <= 0:
        raise InteractiveDenied("position_id_invalid")
    pid = position_id
    with work_lock(home), state_lock(home):
        if read(home) is not None:
            raise InteractiveDenied("interactive_mission_reserved")
        own_conn = conn is None
        conn = conn or _db.get_db()
        try:
            _db.ensure_schema(conn)
            conn.execute("BEGIN IMMEDIATE")
            consent = gate.consent_verdict()
            verdict = gate.toggle_verdict(pid, True, conn)
            if not consent.allowed or consent.context.get("mode") != "authorised":
                raise InteractiveDenied(consent.reason if not consent.allowed else "interactive_authorisation_required")
            if not verdict.allowed:
                raise InteractiveDenied(verdict.reason)
            row = conn.execute("SELECT apply_requested_at FROM positions WHERE id = ?", (pid,)).fetchone()
            reason = (gate._checkpoint_hold(pid, row[0], home_path(home)) or
                      gate._email_hold(conn, pid, row[0], home_path(home)) or
                      gate._essentials_hold(conn, home_path(home)))
            cap = gate.daily_cap_verdict(conn=conn)
            if reason or not cap.allowed:
                raise InteractiveDenied(reason or cap.reason)
            value = {"version": 1, "mission_id": secrets.token_hex(16), "position_id": pid,
                     "owner_id": None, "phase": "admitted", "review_id": None,
                     "command": None, "reason": "", "origin": "user_local"}
            _write(value, home)  # durable BEFORE flag, any queue or wake
            apply_request.write_authorisation(conn, pid, True, apply_request.ORIGIN)
            conn.commit()
            observed = conn.execute("SELECT apply_requested, apply_requested_by FROM positions WHERE id = ?", (pid,)).fetchone()
            if observed[0] != 1 or observed[1] != apply_request.ORIGIN:
                raise InteractiveDenied("interactive_flag_not_observed")
            return value
        except BaseException:
            conn.rollback()
            raise
        finally:
            if own_conn:
                conn.close()


def claim(flow):
    with state_lock(flow._jht_home()):
        value = read(flow._jht_home())
        if (not value or value["position_id"] != flow.position_id or value["phase"] != "admitted"
                or value["owner_id"] or value.get("command")):
            raise InteractiveDenied("interactive_claim_denied")
        value.update(owner_id=secrets.token_hex(16), phase="running", owner_pid=os.getpid(),
                     queue_url=getattr(flow, "_queue_url", "") or flow.url,
                     checkpoint_path=str(Path(flow.checkpoint_path).resolve()),
                     db_path=str(Path(flow.db_path).resolve()) if flow.db_path else None)
        _write(value, flow._jht_home())
        flow._interactive_owner = (value["mission_id"], value["owner_id"])
        return value


def update(flow, **changes):
    with state_lock(flow._jht_home()):
        value = read(flow._jht_home())
        if (not value or value["position_id"] != flow.position_id or
                value.get("owner_pid") != os.getpid() or
                (value.get("mission_id"), value.get("owner_id")) != flow._interactive_owner):
            raise InteractiveDenied("interactive_owner_changed")
        value.update(changes)
        _write(value, flow._jht_home())
        return value


def take_command(flow):
    """Consume a command durably on the Page owner's thread, before effects."""
    with state_lock(flow._jht_home()):
        value = read(flow._jht_home())
        if (not value or value["position_id"] != flow.position_id or
                (value.get("mission_id"), value.get("owner_id")) != flow._interactive_owner or value.get("owner_pid") != os.getpid()):
            raise InteractiveDenied("interactive_owner_changed")
        operation = value.get("command")
        if operation:
            value["command"] = None
            if operation == "confirm":
                value["phase"] = "confirmed"
                value["consumed_review"] = value["review_id"]
            elif operation == "handoff":
                value["phase"] = "handoff_pending"
                value["consumed_review"] = value["review_id"]
            elif operation == "observe":
                value["phase"] = "observing"
            else:
                value["phase"] = "closed"
            _write(value, flow._jht_home())
        return operation


def control(operation, position_id, mission_id, owner_id, review_id=None, *, home=None):
    """Host-authorised local CLI only; never called by CHAT/socket dispatch."""
    with state_lock(home):
        value = read(home)
        if (type(position_id) is not int or not identifier(mission_id) or
                (owner_id is not None and not identifier(owner_id)) or not value or
                (value["position_id"], value.get("mission_id"), value.get("owner_id")) !=
                (position_id, mission_id, owner_id)):
            raise InteractiveDenied("interactive_binding_mismatch")
        if operation in {"confirm", "handoff"}:
            if (value["phase"] != "review_wait" or not identifier(review_id) or
                    review_id != value.get("review_id") or value.get("consumed_review") == review_id):
                raise InteractiveDenied("interactive_review_mismatch")
        elif operation == "observe":
            if value["phase"] != "handoff":
                raise InteractiveDenied("interactive_not_handoff")
        elif operation not in {"finish", "abandon"}:
            raise InteractiveDenied("interactive_command_invalid")
        if value["phase"] in {"completed", "closed", "unknown"} or value.get("command"):
            raise InteractiveDenied("interactive_command_already_consumed")
        if value["phase"] == "admitted" and operation in {"finish", "abandon"}:
            value.update(phase="closed", command=None, reason=operation, input_ready=False)
        else:
            value["command"] = operation
        _write(value, home)
        return value


def cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["admit", "status", "confirm", "handoff", "observe", "finish", "abandon", "ordinary-allowed"])
    parser.add_argument("position_id", type=int, nargs="?")
    parser.add_argument("--mission")
    parser.add_argument("--owner")
    parser.add_argument("--review")
    args = parser.parse_args(argv)
    try:
        if args.operation == "ordinary-allowed":
            reason = guard()
            out = {"allowed": not reason, "reason": reason}
        elif args.operation == "status":
            out = read() or {"phase": "absent"}
        elif args.operation == "admit":
            out = admit(args.position_id)
        else:
            out = control(args.operation, args.position_id, args.mission, args.owner, args.review)
        print(json.dumps(out, sort_keys=True))
        return 1 if out.get("allowed") is False else 0
    except (InteractiveDenied, ValueError, TypeError, sqlite3.Error) as exc:
        print(json.dumps({"error": getattr(exc, "reason", type(exc).__name__)}))
        return 1


if __name__ == "__main__":
    sys.exit(cli())
