"""Unix socket server for the isolated Telegram transport."""

from __future__ import annotations

import os
import signal
import socket
import socketserver
import struct
import sys
import threading
from pathlib import Path

from .protocol import MAX_REQUEST_BYTES, SOCKET_NAME, ProtocolError, encode, parse_request
from .runtime import Runtime, TransportRefusal

CLIENT_UID = int(os.environ.get("JHT_TELEGRAM_CLIENT_UID", "1001"))
MAX_CONCURRENT = 8
READ_TIMEOUT = 15


def socket_dir() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_SOCKET_DIR", "/run/jht-telegram"))


def peer_uid(conn: socket.socket) -> int:
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", raw)
    return uid


def handle(raw: bytes, runtime: Runtime) -> dict:
    try:
        request = parse_request(raw)
        return runtime.dispatch(request)
    except ProtocolError as exc:
        return {"ok": False, "reason": exc.code}
    except TransportRefusal as exc:
        return {"ok": False, "reason": exc.code}
    except Exception:  # noqa: BLE001 - no traceback or remote text to agents
        return {"ok": False, "reason": "telegram_internal_error"}


class _Handler(socketserver.BaseRequestHandler):
    slots = threading.BoundedSemaphore(MAX_CONCURRENT)
    runtime: Runtime

    def handle(self) -> None:
        conn: socket.socket = self.request
        try:
            if peer_uid(conn) != CLIENT_UID:
                conn.sendall(encode({"ok": False, "reason": "peer_not_allowed"}))
                return
        except OSError:
            return
        if not self.slots.acquire(blocking=False):
            conn.sendall(encode({"ok": False, "reason": "telegram_busy"}))
            return
        try:
            conn.settimeout(READ_TIMEOUT)
            raw = b""
            while b"\n" not in raw and len(raw) <= MAX_REQUEST_BYTES:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                raw += chunk
            conn.sendall(encode(handle(raw.split(b"\n", 1)[0], self.runtime)))
        except (OSError, socket.timeout):
            return
        finally:
            self.slots.release()


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def serve() -> int:
    directory = socket_dir()
    path = directory / SOCKET_NAME
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    enabled = os.environ.get("JHT_TELEGRAM_SERVICE_ENABLED", "0") == "1"
    runtime = Runtime(enabled=enabled)
    _Handler.runtime = runtime
    old_umask = os.umask(0o111)
    try:
        server = _Server(str(path), _Handler)
    finally:
        os.umask(old_umask)
    os.chmod(path, 0o666)

    if enabled:
        runtime.start_pollers()

    def stop(*_args: object) -> None:
        runtime.stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(f"[jht-telegram] listening enabled={str(enabled).lower()}", flush=True)
    try:
        server.serve_forever()
    finally:
        runtime.stop_event.set()
        server.server_close()
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(serve())
