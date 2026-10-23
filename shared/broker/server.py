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

from . import mailops, notary, store, telegram_protocol
from .protocol import MAX_REQUEST_BYTES, SOCKET_NAME, ProtocolError, encode, parse_request

CLIENT_UID = int(os.environ.get("JHT_BROKER_CLIENT_UID", "1001"))
TELEGRAM_CLIENT_UID = int(os.environ.get("JHT_TELEGRAM_BROKER_CLIENT_UID", "1003"))
MAX_CONCURRENT = 8
READ_TIMEOUT = 10


def socket_dir() -> Path:
    return Path(os.environ.get("JHT_BROKER_SOCKET_DIR", "/run/jht-broker"))


def telegram_socket_dir() -> Path:
    """The volume shared by broker and Telegram, never by the agents.

    Docker Linux, rootless Podman with keep-id, Docker Desktop macOS, and
    Docker Desktop Windows still need live UID measurements before release;
    this process checks the UID it observes, while the separate volume is the
    actual boundary on every engine.
    """
    return Path(os.environ.get("JHT_TELEGRAM_BROKER_SOCKET_DIR", "/run/jht-broker-telegram"))


def peer_uid(conn: socket.socket) -> int:
    creds = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", creds)
    return uid


HANDLERS = {
    "mail.status": mailops.status,
    "mail.count": mailops.count,
    "mail.poll": mailops.poll,
    "mail.send": mailops.send,
    "apply.check": lambda args, _role: notary.check(args["position_id"]),
    "apply.claim": lambda args, _role: notary.claim(args["position_id"], args["destination"]),
    "apply.revoke": lambda args, _role: notary.revoke(args["position_id"], args["instant"]),
}


def handle(raw: bytes) -> dict:
    try:
        req = parse_request(raw)
    except ProtocolError as err:
        return {"ok": False, "reason": err.code}
    try:
        return HANDLERS[req["op"]](req["args"], req["role"])
    except (mailops.BrokerRefusal, notary.NotaryRefusal, store.StoreError) as err:
        return {"ok": False, "reason": err.code}
    except Exception:  # noqa: BLE001 — never a traceback toward the agents
        return {"ok": False, "reason": "broker_internal_error"}


def handle_telegram(raw: bytes) -> dict:
    """Record only a Telegram click from the private Telegram socket."""
    try:
        req = telegram_protocol.parse_request(raw)
        return notary.record(req["args"]["position_id"], req["args"]["instant"], "user_telegram",
                             req["args"]["destination"])
    except (telegram_protocol.TelegramProtocolError, notary.NotaryRefusal, store.StoreError) as err:
        return {"ok": False, "reason": err.code}
    except Exception:  # noqa: BLE001 — never a traceback toward Telegram
        return {"ok": False, "reason": "broker_internal_error"}


class _RequestHandler(socketserver.BaseRequestHandler):
    slots = threading.BoundedSemaphore(MAX_CONCURRENT)
    allowed_uid = CLIENT_UID
    dispatch = staticmethod(handle)

    def handle(self) -> None:
        conn: socket.socket = self.request
        try:
            if peer_uid(conn) != self.allowed_uid:
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
            conn.sendall(encode(self.dispatch(raw.split(b"\n", 1)[0])))
        except (OSError, socket.timeout):
            return
        finally:
            self.slots.release()


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class _Handler(_RequestHandler):
    """Compatibility name for the existing agents' socket tests."""


class _TelegramHandler(_RequestHandler):
    allowed_uid = TELEGRAM_CLIENT_UID
    dispatch = staticmethod(handle_telegram)


def _listen(directory: Path, handler: type[_RequestHandler]) -> tuple[_Server, Path]:
    path = directory / SOCKET_NAME
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    old = os.umask(0o111)
    try:
        server = _Server(str(path), handler)
    finally:
        os.umask(old)
    os.chmod(path, 0o666)
    return server, path


def serve() -> int:
    server, path = _listen(socket_dir(), _Handler)
    telegram_server, telegram_path = _listen(telegram_socket_dir(), _TelegramHandler)
    signal.signal(signal.SIGTERM, lambda *_: (
        threading.Thread(target=server.shutdown).start(),
        threading.Thread(target=telegram_server.shutdown).start(),
    ))
    threading.Thread(target=telegram_server.serve_forever, daemon=True, name="broker-telegram-socket").start()
    print("[jht-broker] listening", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        telegram_server.server_close()
        for socket_path in (path, telegram_path):
            try:
                os.unlink(socket_path)
            except FileNotFoundError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(serve())
