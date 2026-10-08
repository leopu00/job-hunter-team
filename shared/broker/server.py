"""`jht-broker` serve: the socket the agents talk to (P1 portal secrets, phase 1).

Runs in the `jht-broker` container as uid 1002. The socket lives in the
`jht-broker-sock` volume, the only volume both containers share. The file mode
is not the boundary: every connection's SO_PEERCRED uid must be the agents'
uid (1001), anything else is refused before a byte is read.

One request per connection; the answer is one JSON line. A failure is a fixed
reason code, never a server's text, a value, a length or a hash.
"""

from __future__ import annotations

import os
import signal
import socket
import socketserver
import struct
import sys
import threading
from pathlib import Path

from . import mailops
from .protocol import MAX_REQUEST_BYTES, SOCKET_NAME, ProtocolError, encode, parse_request

CLIENT_UID = int(os.environ.get("JHT_BROKER_CLIENT_UID", "1001"))
MAX_CONCURRENT = 8
READ_TIMEOUT = 10


def socket_dir() -> Path:
    return Path(os.environ.get("JHT_BROKER_SOCKET_DIR", "/run/jht-broker"))


def peer_uid(conn: socket.socket) -> int:
    creds = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", creds)
    return uid


HANDLERS = {
    "mail.status": mailops.status,
    "mail.count": mailops.count,
    "mail.poll": mailops.poll,
    "mail.send": mailops.send,
}


def handle(raw: bytes) -> dict:
    try:
        req = parse_request(raw)
    except ProtocolError as err:
        return {"ok": False, "reason": err.code}
    try:
        return HANDLERS[req["op"]](req["args"], req["role"])
    except mailops.BrokerRefusal as err:
        return {"ok": False, "reason": err.code}
    except Exception:  # noqa: BLE001 — never a traceback toward the agents
        return {"ok": False, "reason": "broker_internal_error"}


class _Handler(socketserver.BaseRequestHandler):
    slots = threading.BoundedSemaphore(MAX_CONCURRENT)

    def handle(self) -> None:
        conn: socket.socket = self.request
        try:
            if peer_uid(conn) != CLIENT_UID:
                conn.sendall(encode({"ok": False, "reason": "peer_not_allowed"}))
                return
        except OSError:
            return
        if not self.slots.acquire(blocking=False):
            conn.sendall(encode({"ok": False, "reason": "broker_busy"}))
            return
        try:
            conn.settimeout(READ_TIMEOUT)
            raw = b""
            while b"\n" not in raw and len(raw) <= MAX_REQUEST_BYTES:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                raw += chunk
            conn.settimeout(None)
            conn.sendall(encode(handle(raw.split(b"\n", 1)[0])))
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
    old = os.umask(0o111)
    try:
        server = _Server(str(path), _Handler)
    finally:
        os.umask(old)
    # The agents connect as another uid: they need write on the socket. Who
    # may talk is decided by SO_PEERCRED above, not by this mode.
    os.chmod(path, 0o666)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    print("[jht-broker] listening", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(serve())
