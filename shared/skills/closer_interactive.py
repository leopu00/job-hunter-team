"""One officially admitted Closer mission, with a host-CLI review confirmation.

The local CLI has the existing user_local trust boundary. Mission/owner/review
identifiers correlate operations; they do NOT authenticate a person or #279.
The slot survives termination and blocks the ordinary queue, including respawn.
"""
from __future__ import annotations

import argparse
import base64
import stat
import socket
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
    from apply_session_lock import SessionBusy, position_lock
except ImportError:
    from shared.skills.apply_session_lock import SessionBusy, position_lock


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
                     "owner_id": None, "generation": 1, "phase": "admitted", "review_id": None,
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
            if (value["phase"] != "review_wait" or
                    (operation == "confirm" and value.get("can_confirm") is False) or not identifier(review_id) or
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



PNG_LIMIT = 8 * 1024 * 1024
EVENT_TTL = 24 * 3600


def _private_dir(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise InteractiveDenied("interactive_artifact_directory_unsafe")
    return path


def _event_dir(value, home=None):
    cache = home_path(home) / ".cache"
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    if cache.is_symlink() or cache.stat().st_uid != os.getuid():
        raise InteractiveDenied("interactive_artifact_directory_unsafe")
    root = _private_dir(_path(home).parent)
    owner = _private_dir(root / value["owner_id"])
    return _private_dir(owner / "events")


def _private_write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _private_read(path, limit):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                info.st_mode & 0o077 or info.st_size > limit):
            raise InteractiveDenied("interactive_artifact_unsafe")
        data = stream.read(limit + 1)
        if len(data) > limit:
            raise InteractiveDenied("interactive_artifact_oversize")
        return data


def _prune_events(directory, now):
    # Only files created by this mission's event writer, never caller paths.
    records = []
    for path in directory.glob("*.json"):
        if not identifier(path.stem):
            continue
        try:
            record = json.loads(_private_read(path, 4096))
            created = record["created_at"]
            if type(created) is not int:
                continue
            records.append((record.get("created_ns", created * 1_000_000_000), created, path.stem))
        except (OSError, ValueError, KeyError, InteractiveDenied):
            continue
    for index, (_, created, event) in enumerate(sorted(records, reverse=True)):
        if index >= 8 or now - created >= EVENT_TTL:
            for suffix in (".png", ".json"):
                (directory / (event + suffix)).unlink(missing_ok=True)


def record_block(flow, page, reason, action="request_handoff"):
    """Capture only the retained owner's Page; expose opaque IDs, never paths."""
    value = read(flow._jht_home())
    if (not value or guard(flow._jht_home(), flow.position_id, flow._interactive_owner)):
        raise InteractiveDenied("interactive_owner_changed")
    event = secrets.token_hex(16)
    directory = _event_dir(value, flow._jht_home())
    reason = reason if isinstance(reason, str) and re.fullmatch(r"[a-z0-9_]{1,80}", reason) else "interactive_blocked"
    if action not in {"review_and_confirm", "request_handoff", "observe_outcome", "finish"}:
        raise InteractiveDenied("interactive_action_invalid")
    record = {"event_id": event, "mission_id": value["mission_id"], "position_id": flow.position_id,
              "owner_id": value["owner_id"], "generation": value.get("generation", 1),
              "reason": reason, "action": action, "created_at": int(time.time()), "created_ns": time.time_ns(),
              "screenshot_available": False, "screenshot_error": "page_unavailable"}
    target = directory / (event + ".png")
    try:
        if page is not None and not page.is_closed():
            from apply_flow import _secrets_hidden
            with _secrets_hidden(page, required=True):
                png = page.screenshot(type="png", full_page=False, timeout=5000)
            if not isinstance(png, bytes) or not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > PNG_LIMIT:
                raise InteractiveDenied("interactive_screenshot_invalid")
            _private_write(target, png)
            record.update(screenshot_available=True, screenshot_error="")
    except Exception:
        target.unlink(missing_ok=True)
        record["screenshot_error"] = "capture_failed"
    try:
        _private_write(directory / (event + ".json"), json.dumps(record).encode())
        update(flow, block=record)
    except BaseException:
        # An incomplete event has no readable metadata for retention. Remove
        # only this allocation, including a partial metadata write, and keep
        # the primary error even if the filesystem also rejects cleanup.
        for suffix in (".png", ".json"):
            with contextlib.suppress(OSError):
                (directory / (event + suffix)).unlink(missing_ok=True)
        raise
    _prune_events(directory, record["created_at"])
    return str(target) if record["screenshot_available"] else ""


def _screen_request(value, request, home=None):
    screen = value.get("screen")
    if not isinstance(screen, dict) or not identifier(screen.get("display_id")):
        raise InteractiveDenied("interactive_display_unavailable")
    root = _private_dir(_private_dir(_path(home).parent) / value["owner_id"])
    path = root / "desktop.sock"
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise InteractiveDenied("interactive_display_unsafe")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(8)
        connection.connect(str(path))
        connection.sendall((json.dumps(request) + "\n").encode())
        response = bytearray()
        deadline = time.monotonic() + 8
        while not response.endswith(b"\n"):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InteractiveDenied("interactive_display_timeout")
            connection.settimeout(remaining)
            block = connection.recv(65536)
            if not block:
                raise InteractiveDenied("interactive_display_unavailable")
            response.extend(block)
            if len(response) > 12 * 1024 * 1024:
                raise InteractiveDenied("interactive_display_oversize")
        result = json.loads(response)
        if (not isinstance(result, dict) or result.get("ok") is not True or
                (result.get("mission_id"), result.get("position_id"), result.get("owner_id"), result.get("generation"), result.get("display_id")) !=
                (value["mission_id"], value["position_id"], value["owner_id"], value.get("generation", 1), screen["display_id"])):
            raise InteractiveDenied("interactive_display_unavailable")
        return result


def descriptor(home=None):
    value = read(home)
    if value is None:
        return {"ok": True, "phase": "absent"}
    result = {key: value.get(key) for key in
              ("mission_id", "position_id", "owner_id", "review_id", "phase", "input_ready", "can_confirm")}
    result.update(ok=True, generation=value.get("generation", 1), input_ready=value.get("input_ready") is True)
    result.update(stream_available=False, display_id=None, frame_sequence=0,
                  allowed_actions=["finish", "abandon"] if value["phase"] not in {"completed", "closed", "unknown"} else [])
    if value.get("owner_id"):
        try:
            display = _screen_request(value, {"op": "describe", "mission_id": value["mission_id"],
                "position_id": value["position_id"], "owner_id": value["owner_id"],
                "generation": value.get("generation", 1)}, home)
            result.update(stream_available=True, display_id=display["display_id"],
                          frame_sequence=display["frame_sequence"], width=display["width"], height=display["height"],
                          allowed_actions=display["allowed_actions"], gate_reason=display["gate_reason"])
            result["stream_available"] = "frame" in display["allowed_actions"]
            result["input_ready"] = result["input_ready"] and "input" in display["allowed_actions"]
        except (InteractiveDenied, OSError, ValueError):
            result["input_ready"] = False
    block = value.get("block")
    if isinstance(block, dict) and value.get("owner_id"):
        _prune_events(_event_dir(value, home), int(time.time()))
        if not identifier(block.get("event_id")) or not (_event_dir(value, home) / (block["event_id"] + ".png")).is_file():
            block = {**block, "screenshot_available": False}
    if isinstance(block, dict):
        result["block"] = {key: block.get(key) for key in
                           ("event_id", "reason", "action", "screenshot_available", "screenshot_error")}
    if isinstance(block, dict) and block.get("screenshot_available"):
        result["allowed_actions"].extend(["snapshot", "delete_snapshot"])
    return result


def snapshot(event_id, mission_id, owner_id, generation, *, home=None):
    if (not all(identifier(x) for x in (event_id, mission_id, owner_id)) or
            type(generation) is not int or generation != 1):
        raise InteractiveDenied("interactive_artifact_binding_invalid")
    value = read(home)
    if (not value or (value["mission_id"], value.get("owner_id"), value.get("generation", 1)) !=
            (mission_id, owner_id, generation)):
        raise InteractiveDenied("interactive_artifact_binding_mismatch")
    directory = _event_dir(value, home)
    record = json.loads(_private_read(directory / (event_id + ".json"), 4096))
    if (record.get("mission_id"), record.get("owner_id"), record.get("generation"), record.get("event_id")) != (mission_id, owner_id, generation, event_id):
        raise InteractiveDenied("interactive_artifact_binding_mismatch")
    if time.time() - record["created_at"] >= EVENT_TTL or not record.get("screenshot_available"):
        raise InteractiveDenied("interactive_screenshot_unavailable")
    data = _private_read(directory / (event_id + ".png"), PNG_LIMIT)
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise InteractiveDenied("interactive_screenshot_invalid")
    return {"ok": True, "mission_id": mission_id, "position_id": value["position_id"], "owner_id": owner_id,
            "generation": generation, "event_id": event_id,
            "png_base64": base64.b64encode(data).decode("ascii")}


def _desktop_request(request, *, home=None):
    """Existing authenticated own-user host transport; never CHAT or worker relay.

    The request selects fixed resources only. IDs correlate this already-admitted
    mission; they do not authenticate an operator or confer #279 authority.
    """
    allowed = {"op", "mission_id", "position_id", "owner_id", "generation", "review_id", "event_id",
               "display_id", "frame_sequence", "kind", "x", "y", "button", "pressed", "key"}
    if type(request) is not dict or set(request) - allowed:
        raise InteractiveDenied("interactive_request_invalid")
    operation = request.get("op")
    if operation == "descriptor":
        if set(request) != {"op"}:
            raise InteractiveDenied("interactive_request_invalid")
        return descriptor(home)
    if operation not in {"snapshot", "delete_snapshot", "confirm", "handoff", "observe", "finish", "abandon", "frame", "input"}:
        raise InteractiveDenied("interactive_request_invalid")
    required = {"op", "mission_id", "position_id", "owner_id", "generation"}
    if operation in {"frame", "input"}:
        required.update({"display_id", "frame_sequence"})
        if operation == "input":
            if request.get("kind") == "pointer":
                required.update({"kind", "x", "y", "button", "pressed"})
            elif request.get("kind") == "key":
                required.update({"kind", "key", "pressed"})
            else:
                raise InteractiveDenied("interactive_input_invalid")
    elif operation in {"snapshot", "delete_snapshot"}:
        required.add("event_id")
    elif operation in {"confirm", "handoff"}:
        required.add("review_id")
    if set(request) != required:
        raise InteractiveDenied("interactive_request_invalid")
    if (not identifier(request["mission_id"]) or not identifier(request["owner_id"]) or
            type(request["position_id"]) is not int or request["position_id"] <= 0 or
            type(request["generation"]) is not int or request["generation"] != 1):
        raise InteractiveDenied("interactive_binding_mismatch")
    value = read(home)
    if (not value or (value["mission_id"], value["position_id"], value.get("owner_id"), value.get("generation", 1)) !=
            (request["mission_id"], request["position_id"], request["owner_id"], request["generation"])):
        raise InteractiveDenied("interactive_binding_mismatch")
    if operation in {"frame", "input"}:
        if (not identifier(request["display_id"]) or type(request["frame_sequence"]) is not int
                or request["frame_sequence"] < 0):
            raise InteractiveDenied("interactive_display_binding_invalid")
        return _screen_request(value, request, home)
    if operation == "snapshot":
        return snapshot(request["event_id"], request["mission_id"], request["owner_id"], request["generation"], home=home)
    if operation == "delete_snapshot":
        event = request["event_id"]
        if not identifier(event):
            raise InteractiveDenied("interactive_artifact_binding_invalid")
        with state_lock(home):
            current = read(home)
            if (not current or (current["mission_id"], current.get("owner_id")) !=
                    (request["mission_id"], request["owner_id"])):
                raise InteractiveDenied("interactive_binding_mismatch")
            directory = _event_dir(current, home)
            for suffix in (".png", ".json"):
                (directory / (event + suffix)).unlink(missing_ok=True)
            if (current.get("block") or {}).get("event_id") == event:
                current["block"].update(screenshot_available=False, screenshot_error="deleted")
                _write(current, home)
        return {"ok": True, "deleted": True}
    value = control(operation, request["position_id"], request["mission_id"], request["owner_id"],
                    request.get("review_id"), home=home)
    return {**descriptor(home), "queued": bool(value.get("command"))}


def desktop_request(request, *, home=None):
    """Sanitised fixed-resource reply for the existing private app transport."""
    try:
        return _desktop_request(request, home=home)
    except (InteractiveDenied, OSError, ValueError, TypeError, KeyError, sqlite3.Error) as exc:
        reason = getattr(exc, "reason", "interactive_request_denied")
        if not isinstance(reason, str) or not re.fullmatch(r"[a-z0-9_]{1,80}", reason):
            reason = "interactive_request_denied"
        return {"ok": False, "error": reason}


def cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["admit", "status", "confirm", "handoff", "observe", "finish", "abandon", "ordinary-allowed", "descriptor", "snapshot"])
    parser.add_argument("position_id", type=int, nargs="?")
    parser.add_argument("--mission")
    parser.add_argument("--owner")
    parser.add_argument("--review")
    parser.add_argument("--event")
    parser.add_argument("--generation", type=int)
    args = parser.parse_args(argv)
    try:
        if args.operation == "ordinary-allowed":
            reason = guard()
            out = {"allowed": not reason, "reason": reason}
        elif args.operation == "descriptor":
            out = descriptor()
        elif args.operation == "snapshot":
            out = snapshot(args.event, args.mission, args.owner, args.generation)
        elif args.operation == "status":
            out = read() or {"phase": "absent"}
        elif args.operation == "admit":
            out = admit(args.position_id)
        else:
            out = control(args.operation, args.position_id, args.mission, args.owner, args.review)
        print(json.dumps(out, sort_keys=True))
        return 1 if out.get("allowed") is False else 0
    except (InteractiveDenied, ValueError, TypeError, sqlite3.Error, OSError) as exc:
        print(json.dumps({"error": getattr(exc, "reason", type(exc).__name__)}))
        return 1


if __name__ == "__main__":
    sys.exit(cli())
