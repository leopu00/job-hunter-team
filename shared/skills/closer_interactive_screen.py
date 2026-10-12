"""Private screen lifecycle for ONE Closer mission, not an operator identity.

Existing shared live-screen/login displays are never changed. The supervisor
owns its Xvfb/x11vnc/websockify children and closes its route on lease EOF,
expiry, stale input lease or explicit revoke, including existing clients.
"""
from __future__ import annotations

import contextlib
import base64
import stat
import ctypes
import json
import os
from pathlib import Path
import secrets
import select
import signal
import socket
import subprocess
import sys
import time


class ScreenDenied(Exception):
    pass


def _frame(fd, timeout):
    deadline = time.monotonic() + timeout
    data = bytearray()
    while time.monotonic() < deadline:
        if not select.select([fd], [], [], max(0, deadline - time.monotonic()))[0]:
            break
        byte = os.read(fd, 1)
        if not byte:
            raise ScreenDenied("screen_lease_eof")
        if byte == b"\n":
            value = json.loads(data)
            if not isinstance(value, dict):
                raise ScreenDenied("screen_frame_invalid")
            return value
        data.extend(byte)
        if len(data) > 4096:
            raise ScreenDenied("screen_frame_oversize")
    raise ScreenDenied("screen_reply_timeout")


def _stop(process):
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def _dies_with_parent(parent):
    """Executed in the supervisor's single-threaded child before exec, Linux only."""
    if not sys.platform.startswith('linux'):
        raise ScreenDenied("screen_requires_linux_parent_death_signal")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, int(signal.SIGKILL), 0, 0, 0) != 0 or os.getppid() != parent:
        raise ScreenDenied("screen_parent_death_binding_failed")


class OwnedScreen:
    def __init__(self, flow, deadline, clock=time.monotonic):
        self.flow, self.deadline, self.clock = flow, deadline, clock
        self.process = None
        self.revoked = False
        self.last_tick = 0

    def __enter__(self):
        import closer_interactive as mission
        value = mission.read(self.flow._jht_home())
        if (not value or (value["mission_id"], value["owner_id"]) != self.flow._interactive_owner
                or value["owner_pid"] != os.getpid()):
            raise ScreenDenied("screen_owner_mismatch")
        root = Path(self.flow._jht_home()) / ".cache" / "closer-interactive" / value["owner_id"]
        root.mkdir(mode=0o700)
        self.root = root
        self.binding = {"mission": value["mission_id"], "owner": value["owner_id"]}
        try:
            parent_pid = os.getpid()
            self.process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "_supervise"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                close_fds=True, preexec_fn=lambda: _dies_with_parent(parent_pid))
            self.process.stdin.write((json.dumps({**self.binding, "root": str(root),
                "home": str(self.flow._jht_home()), "position_id": self.flow.position_id,
                "ttl": min(3600, max(1, self.deadline - self.clock()))}) + "\n").encode())
            self.process.stdin.flush()
            ready = _frame(self.process.stdout.fileno(), 15)
            if ready.get("phase") != "view_only" or not ready.get("display"):
                raise ScreenDenied("screen_start_failed")
            self.display = ready["display"]
            self.route = ready
            mission.update(self.flow, screen={"display": self.display, "display_id": ready["display_id"],
                "ws_port": ready["ws_port"], "password_file": str(root / "viewer-password")},
                input_ready=False)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def _command(self, op):
        self.check()
        self.process.stdin.write((json.dumps({**self.binding, "op": op}) + "\n").encode())
        self.process.stdin.flush()
        reply = _frame(self.process.stdout.fileno(), 6)
        if reply.get("op") != op or reply.get("ok") is not True:
            raise ScreenDenied("screen_control_failed")

    def check(self):
        if self.process is None or self.process.poll() is not None:
            raise ScreenDenied("screen_owner_unavailable")

    def tick(self):
        if not self.revoked and self.clock() - self.last_tick >= 0.2:
            self._command("tick")
            self.last_tick = self.clock()

    def enable(self):
        if self.revoked:
            raise ScreenDenied("screen_revoked")
        import closer_interactive as mission
        from apply_flow import FlowCheckpoint
        value = mission.read(self.flow._jht_home())
        checkpoint = FlowCheckpoint.load(self.flow.checkpoint_path, self.flow.position_id,
                                        getattr(self.flow, "_queue_url", "") or self.flow.url)
        if (not value or value["phase"] != "handoff_pending" or
                (value["mission_id"], value["owner_id"]) != self.flow._interactive_owner or
                not checkpoint.submit_started):
            raise ScreenDenied("screen_handoff_not_durable")
        self._command("enable")

    def revoke(self):
        if not self.revoked:
            self.revoked = True
            if self.process is not None and self.process.poll() is None:
                try:
                    self._command("revoke")
                except BaseException:
                    self.__exit__(None, None, None)
                    raise

    def __exit__(self, *_exc):
        process, self.process = self.process, None
        if process is not None:
            try:
                if process.stdin:
                    process.stdin.close()  # EOF revokes even after abrupt owner exit
                process.wait(timeout=15)
            except (OSError, subprocess.TimeoutExpired):
                _stop(process)
            finally:
                if process.stdout:
                    process.stdout.close()


def _port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _supervise():
    supervisor_pid = os.getpid()
    children = []
    vnc = web = xvfb = None
    listener = client = None
    frame_sequence = 0
    frame_at = 0
    display_id = secrets.token_hex(16)
    stop = False
    read_fd = write_fd = None
    def stopped(*_):
        nonlocal stop
        stop = True
    def spawn(argv, **kwargs):
        parent = os.getpid()
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, close_fds=True,
                             preexec_fn=lambda: _dies_with_parent(parent), **kwargs)
        children.append(p)
        return p
    def reply(value):
        print(json.dumps(value), flush=True)
    def ready_vnc(process, port):
        until = time.monotonic() + 5
        while time.monotonic() < until and not stop:
            if process.poll() is not None:
                raise ScreenDenied("screen_vnc_failed")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1) as client:
                    if client.recv(12).startswith(b"RFB "):
                        return
            except OSError:
                time.sleep(0.05)
        raise ScreenDenied("screen_vnc_timeout")
    def allowed_actions(state):
        from types import SimpleNamespace
        from apply_flow import FlowCheckpoint
        from apply_assisted import check_holds
        import apply_gate as gate
        actions = ["frame", "finish", "abandon"]
        checkpoint = FlowCheckpoint.load(Path(state["checkpoint_path"]), state["position_id"], state["queue_url"])
        consent = gate.consent_verdict()
        verdict = gate.position_verdict(state["position_id"], db_path=state.get("db_path"))
        if not consent.allowed or consent.context.get("mode") != "authorised":
            return actions, consent.reason
        if not verdict.allowed:
            return actions, verdict.reason
        flow = SimpleNamespace(position_id=state["position_id"], db_path=state.get("db_path"),
                               _jht_home=lambda: Path(config["home"]))
        reason = check_holds(flow, verdict, recovery=bool(checkpoint.submit_started))
        if reason:
            return actions, reason
        if state.get("command") or checkpoint.receipt:
            return actions, "interactive_operation_pending"
        if checkpoint.blocked_reason == "vacancy_closed":
            return actions, "vacancy_closed"
        if state["phase"] == "review_wait" and not checkpoint.submit_started:
            if mission.identifier(state.get("review_id")) and state.get("consumed_review") != state["review_id"]:
                if state.get("can_confirm") is True:
                    actions.append("confirm")
                actions.append("handoff")
        if (state["phase"] == "handoff" and checkpoint.submit_started and input_enabled
                and state.get("input_ready") is True and time.monotonic() - last_tick <= 2):
            actions.append("observe")
            if client is not None and time.monotonic() - frame_at <= 2:
                actions.append("input")
        return actions, ""

    try:
        signal.signal(signal.SIGTERM, stopped)
        signal.signal(signal.SIGINT, stopped)
        config = _frame(sys.stdin.fileno(), 5)
        import closer_interactive as mission
        if not all(mission.identifier(config.get(k)) for k in ("mission", "owner")):
            raise ScreenDenied("screen_binding_invalid")
        ttl = config.get("ttl")
        if isinstance(ttl, bool) or not isinstance(ttl, (float, int)) or not 1 <= ttl <= 3600:
            raise ScreenDenied("screen_ttl_invalid")
        deadline = time.monotonic() + ttl
        def owner_state():
            state = mission.read(config["home"])
            if (not state or (state["mission_id"], state["owner_id"]) !=
                    (config["mission"], config["owner"]) or
                    state["position_id"] != config["position_id"] or
                    state.get("owner_pid") != os.getppid() or
                    state["phase"] not in {"running", "review_wait", "handoff_pending", "handoff", "confirmed", "observing"} or
                    state.get("command") in {"finish", "abandon"}):
                raise ScreenDenied("screen_mission_revoked")
            return state
        owner_state()
        root = Path(config["root"])
        if root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
            raise ScreenDenied("screen_directory_unsafe")
        read_fd, write_fd = os.pipe()
        xvfb = spawn(["/usr/bin/Xvfb", "-displayfd", str(write_fd), "-screen", "0",
                      "1440x1000x24", "-nolisten", "tcp"], pass_fds=(write_fd,))
        os.close(write_fd); write_fd = None
        if not select.select([read_fd], [], [], 5)[0]:
            raise ScreenDenied("screen_display_timeout")
        raw = os.read(read_fd, 32).strip()
        if not raw.isdigit() or len(raw) > 4 or xvfb.poll() is not None:
            raise ScreenDenied("screen_display_failed")
        display = ":" + raw.decode("ascii")
        os.close(read_fd); read_fd = None
        password = ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') for _ in range(8))
        fd = os.open(root / "viewer-password", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(password + "\n")
        subprocess.run(["/usr/bin/x11vnc", "-storepasswd", password, str(root / "rfbauth")],
                       check=True, timeout=5, stdin=subprocess.DEVNULL,
                       preexec_fn=lambda: _dies_with_parent(supervisor_pid),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (root / "rfbauth").chmod(0o600)
        del password
        vnc_port, ws_port = _port(), _port()
        base = ["/usr/bin/x11vnc", "-display", display, "-localhost", "-rfbport", str(vnc_port),
                "-rfbauth", str(root / "rfbauth"), "-shared", "-forever", "-noxdamage", "-quiet", "-noremote"]
        vnc = spawn(base + ["-viewonly"])
        ready_vnc(vnc, vnc_port)
        web = spawn(["/usr/bin/websockify", "127.0.0.1:" + str(ws_port), "127.0.0.1:" + str(vnc_port)])
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(root / "desktop.sock"))
        os.chmod(root / "desktop.sock", 0o600)
        listener.listen(2)
        reply({"phase": "view_only", "display": display, "display_id": display_id,
               "ws_port": ws_port, "vnc_port": vnc_port})
        input_enabled = revoked = False
        last_tick = time.monotonic()
        while not stop and time.monotonic() < deadline:
            state = owner_state()
            if xvfb.poll() is not None or (not revoked and any(p.poll() is not None for p in (vnc, web))):
                raise ScreenDenied("screen_child_exited")
            if input_enabled and time.monotonic() - last_tick > 2:
                raise ScreenDenied("screen_input_lease_stale")
            readable = select.select([sys.stdin.fileno(), listener], [], [], 0.1)[0]
            if not readable:
                continue
            if listener in readable and sys.stdin.fileno() not in readable:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(5)
                    try:
                        request = _frame(connection.fileno(), 1)
                        state = owner_state()  # fresh, never the preceding loop snapshot
                        if (request.get("mission_id"), request.get("position_id"), request.get("owner_id"), request.get("generation")) != (config["mission"], config["position_id"], config["owner"], 1):
                            raise ScreenDenied("screen_binding_mismatch")
                        operation = request.get("op")
                        expected = {"op", "mission_id", "position_id", "owner_id", "generation"}
                        if operation in {"frame", "input"}:
                            expected.update({"display_id", "frame_sequence"})
                            if operation == "input":
                                if request.get("kind") == "pointer":
                                    expected.update({"kind", "x", "y", "button", "pressed"})
                                elif request.get("kind") == "key":
                                    expected.update({"kind", "key", "pressed"})
                                else:
                                    raise ScreenDenied("screen_input_invalid")
                        if (set(request) != expected or type(request.get("position_id")) is not int
                                or type(request.get("generation")) is not int or request["generation"] != 1):
                            raise ScreenDenied("screen_request_invalid")
                        actions, gate_reason = allowed_actions(state)
                        result = {"ok": True, "mission_id": config["mission"], "position_id": config["position_id"],
                                  "owner_id": config["owner"], "generation": 1, "display_id": display_id,
                                  "frame_sequence": frame_sequence, "width": 1440, "height": 1000,
                                  "allowed_actions": actions, "gate_reason": gate_reason}
                        if operation != "describe" and request.get("display_id") != display_id:
                            raise ScreenDenied("screen_display_mismatch")
                        if revoked:
                            raise ScreenDenied("screen_revoked")
                        if operation == "frame":
                            if type(request.get("frame_sequence")) is not int or request["frame_sequence"] < 0:
                                raise ScreenDenied("screen_frame_invalid")
                            from closer_desktop_rfb import DisplayClient
                            if client is None:
                                client = DisplayClient(vnc_port, (root / "viewer-password").read_bytes().strip())
                            png = client.frame()
                            if len(png) > 8 * 1024 * 1024:
                                raise ScreenDenied("screen_frame_oversize")
                            frame_sequence += 1
                            frame_at = time.monotonic()
                            actions, gate_reason = allowed_actions(owner_state())
                            result.update(frame_sequence=frame_sequence, png_base64=base64.b64encode(png).decode("ascii"),
                                          allowed_actions=actions, gate_reason=gate_reason)
                        elif operation == "input":
                            import apply_gate as gate
                            consent = gate.consent_verdict()
                            if ("observe" not in actions or not input_enabled or state["phase"] != "handoff" or state.get("input_ready") is not True
                                    or time.monotonic() - last_tick > 2 or time.monotonic() - frame_at > 2
                                    or type(request.get("frame_sequence")) is not int
                                    or request["frame_sequence"] != frame_sequence or client is None
                                    or not consent.allowed or consent.context.get("mode") != "authorised"
                                    or not gate.position_verdict(state["position_id"], db_path=state.get("db_path")).allowed):
                                raise ScreenDenied("screen_input_denied")
                            # Input goes through the SAME view-only/enabled RFB
                            # server. No XTest/Page API path bypasses that barrier.
                            client.input(request)
                            result["accepted"] = True
                        elif operation != "describe":
                            raise ScreenDenied("screen_command_invalid")
                        connection.sendall((json.dumps(result) + "\n").encode())
                    except Exception:
                        if client is not None:
                            client.close(); client = None
                        with contextlib.suppress(OSError):
                            connection.sendall(b'{"ok":false,"error":"screen_request_denied"}\n')
                continue
            command = _frame(sys.stdin.fileno(), 1)
            if any(command.get(k) != config[k] for k in ("mission", "owner")):
                raise ScreenDenied("screen_binding_mismatch")
            operation = command.get("op")
            if operation == "enable" and not revoked and not input_enabled:
                from apply_flow import FlowCheckpoint
                checkpoint = FlowCheckpoint.load(Path(state["checkpoint_path"]), state["position_id"], state["queue_url"])
                import apply_gate as gate
                consent = gate.consent_verdict()
                position = gate.position_verdict(state["position_id"], db_path=state.get("db_path"))
                if (state["phase"] != "handoff_pending" or not checkpoint.submit_started or
                        not consent.allowed or consent.context.get("mode") != "authorised" or
                        not position.allowed):
                    raise ScreenDenied("screen_input_not_authorised")
                # Closing the view-only server also drops every old RFB connection.
                if client is not None:
                    client.close(); client = None
                frame_at = 0
                _stop(vnc)
                vnc = spawn(base)
                ready_vnc(vnc, vnc_port)
                input_enabled = True
            elif operation == "revoke" and not revoked:
                if client is not None:
                    client.close(); client = None
                _stop(web); _stop(vnc)
                revoked = True
                input_enabled = False
            elif operation != "tick":
                raise ScreenDenied("screen_command_invalid")
            if input_enabled:
                import apply_gate as gate
                consent = gate.consent_verdict()
                if (not consent.allowed or consent.context.get("mode") != "authorised" or
                        not gate.position_verdict(state["position_id"], db_path=state.get("db_path")).allowed):
                    raise ScreenDenied("screen_input_revoked")
            last_tick = time.monotonic()
            reply({"ok": True, "op": operation})
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                client.close()
        if listener is not None:
            with contextlib.suppress(OSError):
                listener.close()
        if 'root' in locals():
            with contextlib.suppress(OSError):
                (root / "desktop.sock").unlink()
        for fd in (read_fd, write_fd):
            if fd is not None:
                with contextlib.suppress(OSError):
                    os.close(fd)
        errors = []
        for child in reversed(children):
            try:
                _stop(child)
            except BaseException as exc:
                errors.append(type(exc).__name__)
        if 'root' in locals():
            for name in ("viewer-password", "rfbauth"):
                with contextlib.suppress(OSError):
                    (root / name).unlink()
        if errors:
            raise ScreenDenied("screen_cleanup_failed")


if __name__ == "__main__":
    if sys.argv[1:] != ["_supervise"]:
        raise SystemExit(2)
    try:
        _supervise()
    except BaseException:
        raise SystemExit(1)
