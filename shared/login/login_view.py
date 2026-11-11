"""The window onto the browser of the LinkedIn login: a WebSocket bridge to the VNC socket of the container that holds the browser.

Runs in `jht-login-view`, the only container of the login with a published port (127.0.0.1:6081 of the host, never another address).
It forwards bytes and keeps the limits of the contract the desktop app reads (broker_view.rs):
  - ONE token, 43 characters of base64url (256 bits), kept in memory only and handed out once, through the control socket of this
    container (`docker exec … login_view.py grant`): never in a file, never in a log;
  - the token opens ONE connection, within 120 s of the start; it is used up by the first well-formed attempt with the right value;
  - the session lasts at most 15 minutes from that connection; the whole container at most 18 minutes from its start;
  - the answer to anything but `GET /websockify?token=…` as a WebSocket is a fixed line.
It holds no profile, no display, no password: it is a pipe that does not look into what goes through it. What the browser container writes
in the shared folder (a hint that the login is done) is read as a suggestion, from a closed list, from a plain file of a few bytes.

The WebSocket side is the small part of RFC 6455 that noVNC uses: binary messages, a client that always masks, no extension, ping and
close. A message is at most 1 MiB.

    python3 login_view.py serve <vnc socket> <hint file> [<control socket>]
    python3 login_view.py grant|status|stop [<control socket>]       (the commands the wrapper runs with `docker exec`)

The exit code of `serve` says how the session ended (the engine keeps it): 10 logged_in, 11 login_timeout, 12 token_expired, 13 stopped,
14 view_unavailable.
"""

from __future__ import annotations

import asyncio
import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import stat
import struct
import sys
import time

PORT = 6081
PATH = "/websockify"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
TOKEN_SECONDS = 120
SESSION_SECONDS = 15 * 60
LIFE_SECONDS = 18 * 60
REQUEST_SECONDS = 10
MAX_REQUEST_BYTES = 4096
MAX_HEADER_LINES = 32
MAX_MESSAGE = 1024 * 1024
CHUNK = 65536
CONTROL_SOCKET = "/tmp/login-view-control.sock"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HINTS = ("logged_in", "sandbox_failed", "browser_failed")
EXIT = {"logged_in": 10, "login_timeout": 11, "token_expired": 12, "stopped": 13, "view_unavailable": 14}
REASONS = tuple(EXIT)


def new_token() -> str:
    return secrets.token_urlsafe(32)  # 32 bytes → 43 characters, no padding


def new_session() -> str:
    return secrets.token_hex(6)


def accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")


def valid_key(key: str) -> bool:
    try:
        return len(base64.b64decode(key, validate=True)) == 16
    except Exception:
        return False


def frame(opcode: int, payload: bytes) -> bytes:
    """A frame from the server: never masked."""
    head = bytes([0x80 | opcode])
    size = len(payload)
    if size < 126:
        head += bytes([size])
    elif size < 65536:
        head += bytes([126]) + struct.pack(">H", size)
    else:
        head += bytes([127]) + struct.pack(">Q", size)
    return head + payload


class ProtocolError(Exception):
    pass


async def read_frame(reader: asyncio.StreamReader) -> tuple[bool, int, bytes]:
    """(fin, opcode, payload) of one frame of the client, which must be masked, small and without extension bits."""
    head = await reader.readexactly(2)
    fin, rsv, opcode = bool(head[0] & 0x80), head[0] & 0x70, head[0] & 0x0F
    masked, size = bool(head[1] & 0x80), head[1] & 0x7F
    if rsv or not masked or opcode in (3, 4, 5, 6, 7) or opcode > 10:
        raise ProtocolError("frame")
    if size == 126:
        size = struct.unpack(">H", await reader.readexactly(2))[0]
    elif size == 127:
        size = struct.unpack(">Q", await reader.readexactly(8))[0]
    if size > MAX_MESSAGE or (opcode >= 8 and (size > 125 or not fin)):
        raise ProtocolError("size")
    mask = await reader.readexactly(4)
    data = bytearray(await reader.readexactly(size))
    for i in range(size):
        data[i] ^= mask[i % 4]
    return fin, opcode, bytes(data)


class View:
    """The state of the one session of this container."""

    def __init__(self, vnc_socket: str, hint_file: str, now=time.monotonic) -> None:
        self.vnc_socket, self.hint_file, self.now = vnc_socket, hint_file, now
        self.started = now()
        self.token: str | None = new_token()
        self.session = new_session()
        self.granted = False
        self.state = "waiting"  # waiting | connected | ended
        self.reason: str | None = None
        self.connected_at: float | None = None
        self.done = asyncio.Event()

    def token_left(self) -> float:
        return TOKEN_SECONDS - (self.now() - self.started)

    def end(self, reason: str) -> None:
        if self.reason is None:
            self.reason = reason
            self.state = "ended"
            self.done.set()

    def grant(self) -> dict:
        """The line the desktop app reads. Once: a second ask is `view_busy`."""
        if self.granted or self.state != "waiting" or self.token is None:
            return {"ok": False, "reason": "view_busy"}
        if self.token_left() <= 0:
            return {"ok": False, "reason": "token_expired"}
        failed = self.read_hint()
        if failed == "sandbox_failed":
            return {"ok": False, "reason": "chromium_sandbox_unavailable"}
        if failed == "browser_failed":
            return {"ok": False, "reason": "view_unavailable"}
        try:
            if not stat.S_ISSOCK(os.lstat(self.vnc_socket).st_mode):
                raise OSError
        except OSError:
            return {"ok": False, "reason": "view_unavailable"}  # the browser is not there yet: the token is not used up, ask again
        self.granted = True
        expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=self.token_left())
        return {"ok": True, "port": PORT, "path": PATH, "token": self.token, "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "session": self.session}

    def status(self) -> dict:
        out = {"ok": True, "view": {"waiting": "waiting", "connected": "connected", "ended": "idle"}[self.state]}
        if self.reason is not None:
            out["last_session"] = {"reason": self.reason}
        return out

    def take_token(self, offered: str) -> str | None:
        """None when the token is good (and used up), else the reason."""
        if self.state != "waiting" or self.token is None:
            return "view_busy"
        if not hmac.compare_digest(offered.encode("ascii"), self.token.encode("ascii")):
            return "token_invalid"
        if self.token_left() <= 0:
            return "token_expired"
        self.token = None
        self.state = "connected"
        self.connected_at = self.now()
        return None

    def read_hint(self) -> str | None:
        """A suggestion from the browser container: a plain file of a few bytes with a word of a closed list. Never trusted further."""
        try:
            info = os.lstat(self.hint_file)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 32:
                return None
            with open(self.hint_file, "rb") as handle:
                word = handle.read(33).decode("ascii", "ignore").strip()
        except OSError:
            return None
        return word if word in HINTS else None


def parse_request(raw: list[bytes]) -> dict | None:
    """The request line and headers of a WebSocket opening → {'token', 'key', 'protocols'}, or None."""
    try:
        line = raw[0].decode("ascii").rstrip("\r\n").split(" ")
        if len(line) != 3 or line[0] != "GET" or line[2] != "HTTP/1.1":
            return None
        target = line[1]
        if "?" not in target:
            return None
        path, query = target.split("?", 1)
        if path != PATH or not query.startswith("token=") or "&" in query or not TOKEN_RE.fullmatch(query[6:]):
            return None
        headers = {}
        for item in raw[1:]:
            text = item.decode("ascii").rstrip("\r\n")
            if not text:
                continue
            name, _, value = text.partition(":")
            headers[name.strip().lower()] = value.strip()
    except (UnicodeDecodeError, IndexError):
        return None
    if headers.get("upgrade", "").lower() != "websocket" or "upgrade" not in headers.get("connection", "").lower():
        return None
    if headers.get("sec-websocket-version") != "13" or not valid_key(headers.get("sec-websocket-key", "")):
        return None
    protocols = [item.strip() for item in headers.get("sec-websocket-protocol", "").split(",") if item.strip()]
    return {"token": query[6:], "key": headers["sec-websocket-key"], "protocols": protocols}


def http_reply(code: int, text: str) -> bytes:
    return f"HTTP/1.1 {code} {text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".encode("ascii")


async def read_head(reader: asyncio.StreamReader) -> list[bytes] | None:
    lines: list[bytes] = []
    size = 0
    try:
        while True:
            line = await asyncio.wait_for(reader.readline(), REQUEST_SECONDS)
            size += len(line)
            if not line.endswith(b"\n") or size > MAX_REQUEST_BYTES or len(lines) > MAX_HEADER_LINES:
                return None
            if line in (b"\r\n", b"\n"):
                return lines
            lines.append(line)
    except (asyncio.TimeoutError, asyncio.LimitOverrunError, ConnectionError, ValueError):
        return None


async def handle(view: View, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await read_head(reader)
        request = parse_request(head) if head else None
        if request is None:
            writer.write(http_reply(404, "Not Found"))
            await writer.drain()
            return
        refusal = view.take_token(request["token"])
        if refusal == "token_expired":
            view.end("token_expired")
        if refusal is not None:
            writer.write(http_reply(403, "Forbidden"))
            await writer.drain()
            return
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_unix_connection(view.vnc_socket), 5)
        except Exception:
            view.end("view_unavailable")
            writer.write(http_reply(502, "Bad Gateway"))
            await writer.drain()
            return
        extra = "Sec-WebSocket-Protocol: binary\r\n" if "binary" in request["protocols"] else ""
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept_key(request['key'])}\r\n{extra}\r\n").encode("ascii"))
        await writer.drain()
        try:
            await bridge(view, reader, writer, up_reader, up_writer)
        finally:
            up_writer.close()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def bridge(view: View, reader, writer, up_reader, up_writer) -> None:
    async def from_client() -> None:
        pending = b""
        while True:
            fin, opcode, data = await read_frame(reader)
            if opcode == 8:
                writer.write(frame(8, b""))
                view.end("stopped")
                return
            if opcode == 9:
                writer.write(frame(10, data))
                await writer.drain()
                continue
            if opcode == 10:
                continue
            if opcode == 1:
                raise ProtocolError("text")
            pending += data
            if len(pending) > MAX_MESSAGE:
                raise ProtocolError("message")
            if fin:
                up_writer.write(pending)
                await up_writer.drain()
                pending = b""

    async def from_vnc() -> None:
        while True:
            data = await up_reader.read(CHUNK)
            if not data:
                view.end("stopped")
                return
            writer.write(frame(2, data))
            await writer.drain()

    async def watch() -> None:
        deadline = (view.connected_at or view.now()) + SESSION_SECONDS
        while view.reason is None:
            if view.now() >= deadline:
                view.end("login_timeout")
                return
            if view.read_hint() == "logged_in":
                await asyncio.sleep(2)  # the person sees the page that says it worked
                view.end("logged_in")
                return
            await asyncio.sleep(1)

    tasks = [asyncio.create_task(task()) for task in (from_client, from_vnc, watch)]
    done_task = asyncio.create_task(view.done.wait())
    try:
        await asyncio.wait([*tasks, done_task], return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (*tasks, done_task):
            task.cancel()
        await asyncio.gather(*tasks, done_task, return_exceptions=True)  # nothing of what went wrong is printed
        view.end("stopped")
        try:
            writer.write(frame(8, struct.pack(">H", 1000)))
            await writer.drain()
        except Exception:
            pass


async def control(view: View, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        word = (await asyncio.wait_for(reader.readline(), 5)).decode("ascii", "ignore").strip()
        if word == "grant":
            answer = view.grant()
        elif word == "status":
            answer = view.status()
        elif word == "stop":
            view.end("stopped")
            answer = {"ok": True}
        else:
            answer = {"ok": False, "reason": "view_unavailable"}
        writer.write((json.dumps(answer) + "\n").encode("ascii"))
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def serve(vnc_socket: str, hint_file: str, control_path: str = CONTROL_SOCKET, host: str = "0.0.0.0", port: int = PORT, now=time.monotonic) -> int:
    view = View(vnc_socket, hint_file, now)
    old = os.umask(0o177)
    try:
        if os.path.lexists(control_path):
            os.unlink(control_path)
        control_server = await asyncio.start_unix_server(lambda r, w: control(view, r, w), path=control_path)
    finally:
        os.umask(old)
    web = await asyncio.start_server(lambda r, w: handle(view, r, w), host, port, limit=MAX_REQUEST_BYTES * 2)

    async def expire() -> None:
        while view.reason is None:
            if view.state == "waiting" and view.token_left() <= 0:
                view.end("token_expired")
            if now() - view.started >= LIFE_SECONDS:
                view.end("login_timeout")
            await asyncio.sleep(0.5)

    watcher = asyncio.create_task(expire())
    try:
        await view.done.wait()
        await asyncio.sleep(0.2)  # the last answer reaches whoever asked
    finally:
        watcher.cancel()
        web.close()
        control_server.close()
    return EXIT[view.reason or "stopped"]


def ask(command: str, control_path: str = CONTROL_SOCKET) -> int:
    """The side of `docker exec`: one line to the control socket, the answer printed as it is."""
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(5)
            sock.connect(control_path)
            sock.sendall((command + "\n").encode("ascii"))
            data = b""
            while not data.endswith(b"\n") and len(data) < 4096:
                chunk = sock.recv(1024)
                if not chunk:
                    break
                data += chunk
        text = data.decode("ascii", "ignore").strip()
        json.loads(text)
    except Exception:
        print(json.dumps({"ok": False, "reason": "view_unavailable"}))
        return 1
    print(text)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) in (3, 4) and argv[0] == "serve":
        try:
            return asyncio.run(serve(argv[1], argv[2], argv[3] if len(argv) == 4 else CONTROL_SOCKET))
        except KeyboardInterrupt:
            return EXIT["stopped"]
    if len(argv) in (1, 2) and argv[0] in ("grant", "status", "stop"):
        return ask(argv[0], argv[1] if len(argv) == 2 else CONTROL_SOCKET)
    print("usage: login_view.py serve <vnc socket> <hint file> [<control socket>] | grant|status|stop [<control socket>]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
