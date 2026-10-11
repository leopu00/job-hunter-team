"""Explicit, local assisted ownership of the real application page.

The private socket is a technical controller, NOT operator authentication.
It never changes consent, authorisation, checkpoints to ready, or throttles.
Any human input is conservatively a possible submit, durably marked BEFORE
control is granted.  Recovery can then only observe a receipt, never click again.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import secrets
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time

from apply_flow import ApplicationFlow, FlowCheckpoint, FlowResult, _load_profile, _utc_now
from apply_session_lock import SessionBusy, position_lock


class AssistedDenied(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class OwnerStopped(BaseException):
    pass


def _interrupt_driver(flow):
    """Use the owned subprocess handle, never a potentially recycled PID."""
    driver = getattr(flow, "_playwright_driver", None)
    if driver is not None and driver.returncode is None:
        with contextlib.suppress(ProcessLookupError, RuntimeError):
            driver.terminate()


def check_holds(flow, verdict, *, recovery=False):
    """Read the same holds as the queue, without its CV rendering/writes.

    Recovery with submit_started only observes an existing outcome: it does
    not ask for a second quota slot or lift a checkpoint for another submit.
    Email holds still win; that transport may have an unresolved outcome too.
    """
    import apply_gate as gate

    home = flow._jht_home()
    at = verdict.context.get("at")
    if not recovery:
        hold = gate._checkpoint_hold(flow.position_id, at, home)
        if hold:
            return hold
    path = Path(flow.db_path or gate._db_path()).resolve()
    try:
        with contextlib.closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.execute("PRAGMA query_only=ON")
            hold = gate._email_hold(conn, flow.position_id, at, home)
            if hold:
                return hold
            hold = gate._essentials_hold(conn, home)
            if hold:
                return hold
            if not recovery:
                cap = gate.daily_cap_verdict(conn=conn)
                if not cap.allowed:
                    return cap.reason
    except (sqlite3.Error, OSError, ValueError):
        return "assisted_holds_unreadable"
    return ""


class AssistedSession:
    def __init__(self, flow, ttl=1800, eligibility_checker=check_holds, clock=time.monotonic):
        if isinstance(ttl, bool) or not 1 <= ttl <= 3600:
            raise ValueError("assisted_ttl_invalid")
        self.flow = flow
        self.deadline = clock() + ttl
        self.clock = clock
        self.eligibility_checker = eligibility_checker
        self.phase = "ready"
        self.result = None
        self.page = None
        self.closed_reason = ""
        self._stack = contextlib.ExitStack()

    def _checkpoint(self):
        return FlowCheckpoint.load(self.flow.checkpoint_path, self.flow.position_id,
                                   getattr(self.flow, "_queue_url", "") or self.flow.url)

    def _eligible(self, *, recovery=False):
        verdict = self.flow._gate()
        if getattr(verdict, "allowed", None) is not True:
            raise AssistedDenied(verdict.reason)
        if verdict.context.get("mode") not in {"authorised", "dry_run"}:
            raise AssistedDenied("gate_mode_unknown")
        reason = self.eligibility_checker(self.flow, verdict, recovery=recovery)
        if reason:
            raise AssistedDenied(reason)
        return verdict

    def __enter__(self):
        try:
            self._stack.enter_context(position_lock(self.flow._jht_home(), self.flow.position_id, owner=self.flow))
            self._eligible(recovery=bool(self._checkpoint().submit_started))
            profile_stop = self.flow._linkedin_profile_stop(self._checkpoint())
            if profile_stop is not None:
                raise AssistedDenied(profile_stop.reason)
            self.flow._assisted_owner = True
            self.flow._playwright_driver = None
            self._stack.callback(setattr, self.flow, "_assisted_owner", False)
            self._stack.callback(setattr, self.flow, "_playwright_driver", None)
            self.page = self._stack.enter_context(self.flow._managed_page())
            return self
        except BaseException:
            self._stack.close()
            raise

    def __exit__(self, *_exc):
        self.close("owner_exit")

    def close(self, reason="finished"):
        if self.phase == "closed":
            return self.status()
        self.phase = "closed"
        self.closed_reason = reason
        self._stack.close()
        return self.status()

    def status(self):
        result = self.result
        return {"phase": self.phase, "position_id": self.flow.position_id,
                "reason": self.closed_reason,
                "result": None if result is None else {
                    "status": result.status, "state": result.state,
                    "reason": result.reason, "receipt": bool(result.receipt)}}

    def _check_live(self):
        if self.phase == "closed":
            raise AssistedDenied("assisted_closed")
        if self.clock() >= self.deadline:
            self.close("expired")
            raise AssistedDenied("assisted_expired")
        if self.page is None or self.page.is_closed():
            self.close("disconnected")
            raise AssistedDenied("assisted_disconnected")

    def run(self, *, navigate=True):
        self._check_live()
        checkpoint = self._checkpoint()
        try:
            self._eligible(recovery=bool(checkpoint.submit_started))
        except AssistedDenied as exc:
            self.result = FlowResult("denied", checkpoint.state, exc.reason)
            self.phase = "blocked"
            return self.status()
        # The same Page, context, cookies and browser are owned outside run.
        # With submit_started (including handoff), run observes only receipts.
        self.phase = "running"
        self.result = self.flow.run(page=self.page, navigate=navigate)
        self.phase = "completed" if self.result.status in {"applied", "dry_run"} else "blocked"
        return self.status()

    def _handoff(self):
        self._check_live()
        if self.phase != "blocked":
            raise AssistedDenied("assisted_handoff_not_blocked")
        checkpoint = self._checkpoint()
        if checkpoint.receipt:
            raise AssistedDenied("assisted_already_complete")
        verdict = self._eligible(recovery=bool(checkpoint.submit_started))
        if verdict.context.get("mode") != "authorised":
            raise AssistedDenied("assisted_handoff_requires_authorisation")
        if not checkpoint.submit_started:
            slot = self.flow.cap_reserver(position_id=self.flow.position_id, db_path=self.flow.db_path)
            if getattr(slot, "allowed", None) is not True:
                raise AssistedDenied(slot.reason)
            # Even Enter, onchange and a script can submit.  This is NOT a
            # claim that a click occurred; it means the outcome may change.
            checkpoint.submit_started = True
            checkpoint.submit_started_at = _utc_now()
            checkpoint.state = "submit"
            try:
                checkpoint.save(self.flow.checkpoint_path)
            except BaseException:
                self.flow._release_cap_slot(slot)
                raise
        self.phase = "handoff"
        return self.status()

    def _input(self, payload):
        self._check_live()
        if self.phase != "handoff" or not self._checkpoint().submit_started:
            raise AssistedDenied("assisted_input_requires_handoff")
        verdict = self._eligible(recovery=True)
        if verdict.context.get("mode") != "authorised":
            raise AssistedDenied("assisted_input_requires_authorisation")
        action = payload.get("action")
        if action == "click":
            x, y = payload.get("x"), payload.get("y")
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or
                   not math.isfinite(v) or v < 0 or v > 10000 for v in (x, y)):
                raise AssistedDenied("assisted_input_invalid")
            self.page.mouse.click(x, y)
        elif action == "type":
            text = payload.get("text")
            if not isinstance(text, str) or len(text) > 4000:
                raise AssistedDenied("assisted_input_invalid")
            self.page.keyboard.insert_text(text)
        elif action == "press":
            key = payload.get("key")
            if not isinstance(key, str) or not 0 < len(key) <= 80:
                raise AssistedDenied("assisted_input_invalid")
            self.page.keyboard.press(key)
        else:
            raise AssistedDenied("assisted_input_invalid")
        return self.status()

    def command(self, payload):
        try:
            if not isinstance(payload, dict):
                raise AssistedDenied("assisted_command_invalid")
            op = payload.get("op")
            if op in {"finish", "abandon"}:
                return self.close("finished" if op == "finish" else "abandoned")
            self._check_live()
            if op == "status":
                return self.status()
            if op == "resume":
                return self.run(navigate=False)
            if op == "handoff":
                return self._handoff()
            if op == "input":
                return self._input(payload)
            raise AssistedDenied("assisted_command_invalid")
        except AssistedDenied as exc:
            return {**self.status(), "error": exc.reason}


def _private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise AssistedDenied("assisted_directory_unsafe")
    path.chmod(0o700)
    return path


def _paths(position_id):
    home = Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")
    root = _private_dir(home / ".cache" / "assisted")
    return _private_dir(root / str(int(position_id)))


def _write(path, data):
    temporary = path.with_name(path.name + "." + secrets.token_hex(4))
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_private(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise AssistedDenied("assisted_file_unsafe")
        return json.load(stream)


def request(position_id, payload):
    """No identity assertion: possession of this local socket grants no send."""
    root = _paths(position_id)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3 if payload.get("op") == "status" else 660)
        try:
            client.connect(str(root / "control.sock"))
            client.sendall(json.dumps(payload).encode() + b"\n")
            with client.makefile("rb") as stream:
                response = stream.readline(65537)
            if len(response) > 65536:
                raise ValueError("oversize_response")
            return json.loads(response)
        except (OSError, ValueError):
            return {"error": "assisted_owner_unavailable"}


def start(args):
    if os.name != "posix" or not 1 <= args.assisted_ttl <= 3600:
        return {"error": "assisted_platform_or_ttl_invalid"}
    root = _paths(args.position_id)
    existing = request(args.position_id, {"op": "status"})
    if "error" not in existing:
        return {"status": "assisted_exists", **existing}
    identifier = secrets.token_hex(8)
    config = root / ("start-" + identifier + ".json")
    _write(config, {"owner_id": identifier, **{
        key: str(value) if isinstance(value, Path) else value
        for key, value in vars(args).items()}})
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_owner", str(config)],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            value = _read_private(root / ("started-" + identifier + ".json"))
            if value.get("owner_id") == identifier:
                (root / ("started-" + identifier + ".json")).unlink(missing_ok=True)
                return {"status": "assisted_started" if value.get("phase") != "closed" else "assisted_failed", **value}
        except (OSError, ValueError, AssistedDenied):
            pass
        time.sleep(0.05)
    return {"error": "assisted_start_unconfirmed"}


def _serve(config_path):
    config = _read_private(config_path)
    root = config_path.parent
    owner_id = config["owner_id"]
    session = None
    server = None
    owns_socket = False
    announced = False
    stop_requested = False
    state = {"phase": "starting", "position_id": config["position_id"]}

    def publish():
        nonlocal announced
        value = {"owner_id": owner_id, "pid": os.getpid(), **state}
        if owns_socket:
            _write(root / "status.json", value)
        if not announced:
            _write(root / ("started-" + owner_id + ".json"), value)
            announced = True

    def stopped(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True
        # Interrupt the pipe transport without raising across a live sync
        # Playwright greenlet. Chromium closes when its driver pipe dies;
        # normal API failure then unwinds resource owners on their thread.
        _interrupt_driver(flow)

    try:
        flow = ApplicationFlow(
            position_id=config["position_id"], url=config["url"],
            profile=_load_profile(Path(config["profile"])), profile_path=config["profile"],
            cv_path=config["cv"], checkpoint_path=config.get("checkpoint"),
            receipt_dir=config.get("receipt_dir"), db_path=config.get("db"), headless=False)
        signal.signal(signal.SIGTERM, stopped)
        signal.signal(signal.SIGINT, stopped)
        signal.signal(signal.SIGALRM, stopped)
        signal.setitimer(signal.ITIMER_REAL, config["assisted_ttl"])
        with AssistedSession(flow, ttl=config["assisted_ttl"]) as session:
            if stop_requested:
                raise OwnerStopped()
            sock_path = root / "control.sock"
            sock_path.unlink(missing_ok=True)  # exclusive position owner held
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(str(sock_path))
            sock_path.chmod(0o600)
            owns_socket = True
            server.listen(4)
            server.settimeout(0.1)
            state = {**session.status(), "phase": "running"}
            publish()
            state = session.run(navigate=True)
            publish()
            if session.phase == "blocked":
                # A live assisted stop must be visible now, not only deferred
                # to the next worker round.  Never include page contents/URLs.
                with contextlib.suppress(Exception):
                    flow.notifier(position_id=flow.position_id, message=(
                        "Assisted application paused: " + (session.result.reason or "blocked") +
                        ". The actual browser remains open. Viewing is not input. "
                        "An explicitly authorised local handoff is required for human control; "
                        "possible human submission will prohibit a second submit."))
            while session.phase != "closed":
                if stop_requested:
                    raise OwnerStopped()
                session._check_live()
                try:
                    client, _ = server.accept()
                except socket.timeout:
                    session.page.wait_for_timeout(50)
                    continue
                with client:
                    client.settimeout(2)
                    try:
                        with client.makefile("rb") as stream:
                            raw = stream.readline(16385)
                        if len(raw) > 16384:
                            raise ValueError("oversize_request")
                        state = session.command(json.loads(raw))
                    except (ValueError, OSError):
                        state = {**session.status(), "error": "assisted_request_invalid"}
                    publish()
                    with contextlib.suppress(OSError):
                        client.sendall(json.dumps(state).encode() + b"\n")
    except OwnerStopped:
        state = {**(session.status() if session else state), "phase": "closed", "reason": "expired_or_stopped"}
    except (AssistedDenied, SessionBusy) as exc:
        state = {**(session.status() if session else state), "phase": "closed",
                 "reason": getattr(exc, "reason", "application_session_busy")}
    except Exception as exc:
        state = {**(session.status() if session else state), "phase": "closed",
                 "reason": "expired_or_stopped" if stop_requested else type(exc).__name__}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if session:
            session.close("owner_exit")
        if server:
            server.close()
        if owns_socket:
            (root / "control.sock").unlink(missing_ok=True)
        publish()
        config_path.unlink(missing_ok=True)


def main(argv=None):
    values = list(sys.argv[1:] if argv is None else argv)
    if values and values[0] == "_owner":
        _serve(Path(values[1]))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["status", "resume", "handoff", "input", "finish", "abandon"])
    parser.add_argument("--position-id", type=int, required=True)
    args = parser.parse_args(values)
    payload = {"op": args.operation}
    if args.operation == "input":
        payload = json.load(sys.stdin)
        payload["op"] = "input"
    result = request(args.position_id, payload)
    print(json.dumps(result, sort_keys=True))
    return 1 if result.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
