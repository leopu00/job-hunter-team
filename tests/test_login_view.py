"""shared/login/login_view.py: the window onto the browser of the LinkedIn login. One token of 43 characters handed out once, good for one
connection within 120 s; a session of 15 minutes at most; a bridge that forwards bytes and knows only what noVNC speaks of WebSocket; a
fixed answer for anything else; the exit code that says how the session ended. A fake VNC server on a unix socket stands for the browser."""
from __future__ import annotations

import asyncio
import io
import base64
import hashlib
import importlib.util
import json
import os
import re
import socket
import struct
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("login_view", ROOT / "shared" / "login" / "login_view.py")
lv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lv)

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
SAMPLE_KEY = base64.b64encode(bytes(range(16))).decode()   # a client key: sixteen bytes, base64


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def mask_frame(opcode: int, payload: bytes, fin: bool = True, masked: bool = True) -> bytes:
    head = bytes([(0x80 if fin else 0) | opcode])
    size = len(payload)
    flag = 0x80 if masked else 0
    if size < 126:
        head += bytes([flag | size])
    elif size < 65536:
        head += bytes([flag | 126]) + struct.pack(">H", size)
    else:
        head += bytes([flag | 127]) + struct.pack(">Q", size)
    if not masked:
        return head + payload
    key = b"\x01\x02\x03\x04"
    return head + key + bytes(b ^ key[i % 4] for i, b in enumerate(payload))


class Rig:
    """The server on a free port, a fake VNC socket that answers `vnc:` + what it gets, and the hint file."""

    def __init__(self, tmp: Path, monkeypatch, make_vnc: bool = True):
        self.dir = Path(tempfile.mkdtemp(prefix="lv", dir="/tmp"))
        self.vnc, self.hint, self.control = str(self.dir / "vnc.sock"), self.dir / "hint", str(self.dir / "c.sock")
        self.port = free_port()
        self.make_vnc = make_vnc
        self.received: list[bytes] = []
        self.monkeypatch = monkeypatch
        self.exit_code: int | None = None
        self.clock = [0.0]
        self.token = lv.new_token()  # what the app brings: the view never makes the token it hands over

    async def start(self):
        if self.make_vnc:
            async def vnc(reader, writer):
                try:
                    while True:
                        data = await reader.read(65536)
                        if not data:
                            break
                        self.received.append(data)
                        writer.write(b"vnc:" + data)
                        await writer.drain()
                finally:
                    writer.close()
            self.vnc_server = await asyncio.start_unix_server(vnc, path=self.vnc)
        self.task = asyncio.create_task(lv.serve(self.vnc, str(self.hint), self.control, "127.0.0.1", self.port, now=lambda: self.clock[0]))
        for _ in range(100):
            if os.path.exists(self.control):
                break
            await asyncio.sleep(0.02)
        return self

    async def stop(self):
        if not self.task.done():
            self.task.cancel()
        try:
            await self.task
        except BaseException:
            pass
        if self.make_vnc:
            self.vnc_server.close()

    async def ctl_raw(self, line: str) -> dict:
        reader, writer = await asyncio.open_unix_connection(self.control)
        writer.write((line + "\n").encode())
        await writer.drain()
        answer = await reader.readline()
        writer.close()
        return json.loads(answer)

    async def ctl(self, word: str) -> dict:
        """`grant` brings the token of the rig; the answer of the view has none, so the rig adds it for the tests that connect with it."""
        if word != "grant":
            return await self.ctl_raw(word)
        answer = await self.ctl_raw("grant " + self.token)
        assert "token" not in answer, "the answer of the view must never hold the token"
        return {**answer, "token": self.token} if answer.get("ok") else answer

    async def raw(self, request: bytes):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        writer.write(request)
        await writer.drain()
        return reader, writer

    def upgrade(self, token: str, key: str | None = None, extra: str = "", path: str = "/websockify", query: str | None = None) -> bytes:
        key = key or base64.b64encode(os.urandom(16)).decode()
        q = query if query is not None else f"token={token}"
        return (f"GET {path}?{q} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                f"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n{extra}\r\n").encode()


async def status_line(reader) -> str:
    return (await asyncio.wait_for(reader.readline(), 5)).decode().strip()


async def read_headers(reader) -> dict:
    headers = {}
    while True:
        line = (await asyncio.wait_for(reader.readline(), 5)).decode().strip()
        if not line:
            return headers
        name, _, value = line.partition(":")
        headers[name.strip().lower()] = value.strip()


async def read_server_frame(reader):
    head = await asyncio.wait_for(reader.readexactly(2), 5)
    opcode, size = head[0] & 0x0F, head[1] & 0x7F
    assert not head[1] & 0x80, "a server never masks"
    if size == 126:
        size = struct.unpack(">H", await reader.readexactly(2))[0]
    elif size == 127:
        size = struct.unpack(">Q", await reader.readexactly(8))[0]
    return opcode, await reader.readexactly(size)


def case(monkeypatch, body, make_vnc=True):
    async def go():
        rig = await Rig(None, monkeypatch, make_vnc).start()
        try:
            return await body(rig)
        finally:
            await rig.stop()
    return asyncio.run(go())


def test_the_grant_is_the_line_the_app_reads_and_is_handed_out_once(monkeypatch):
    async def body(rig):
        first = await rig.ctl("grant")
        second = await rig.ctl("grant")
        return first, second
    first, second = case(monkeypatch, body)
    assert first["ok"] is True and first["port"] == 6081 and first["path"] == "/websockify"
    assert re.fullmatch(r"[0-9a-f]{1,32}", first["session"])
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", first["expires_at"])
    assert second == {"ok": False, "reason": "view_busy"}


def test_the_answer_of_the_grant_holds_no_token_and_the_one_brought_is_the_one_that_opens(monkeypatch):
    async def body(rig):
        raw = await rig.ctl_raw("grant " + rig.token)
        reader, writer = await rig.raw(rig.upgrade(rig.token))
        status = await status_line(reader)
        writer.close()
        return raw, status
    raw, status = case(monkeypatch, body)
    assert raw["ok"] is True and set(raw) == {"ok", "port", "path", "expires_at", "session"}
    assert " 101 " in status


def test_the_token_the_view_made_for_itself_opens_nothing(monkeypatch):
    """Until a grant brings a token the only one is a random one nobody has seen; once the app's is in, only that one works."""
    async def body(rig):
        mine = lv.new_token()
        await rig.ctl_raw("grant " + mine)
        reader, writer = await rig.raw(rig.upgrade(lv.new_token()))
        refused = await status_line(reader)
        writer.close()
        return refused
    assert " 101 " not in case(monkeypatch, body)


@pytest.mark.parametrize("line", ["grant", "grant ", "grant short", "grant " + "a" * 44, "grant " + "a" * 42 + "!", "grant a b", "grant " + "a" * 43 + " extra"])
def test_a_grant_without_a_well_formed_token_is_refused_and_does_not_use_the_view_up(monkeypatch, line):
    async def body(rig):
        refused = await rig.ctl_raw(line)
        later = await rig.ctl("grant")
        return refused, later
    refused, later = case(monkeypatch, body)
    assert refused == {"ok": False, "reason": "token_required"}
    assert later["ok"] is True


def test_the_token_is_never_the_same_twice_and_has_256_bits():
    tokens = {lv.new_token() for _ in range(50)}
    assert len(tokens) == 50 and all(re.fullmatch(r"[A-Za-z0-9_-]{43}", token) for token in tokens)


def test_without_the_browser_socket_the_grant_says_unavailable_and_does_not_use_the_token_up(monkeypatch):
    async def body(rig):
        early = await rig.ctl("grant")
        rig.vnc_server = await asyncio.start_unix_server(lambda r, w: None, path=rig.vnc)
        late = await rig.ctl("grant")
        rig.vnc_server.close()
        return early, late
    early, late = case(monkeypatch, body, make_vnc=False)
    assert early == {"ok": False, "reason": "view_unavailable"} and late["ok"] is True


def test_one_connection_with_the_token_forwards_bytes_both_ways_and_the_token_is_then_used_up(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"], key=SAMPLE_KEY))
        line = await status_line(reader)
        headers = await read_headers(reader)
        writer.write(mask_frame(2, b"hello" * 5000))
        await writer.drain()
        got = b""
        while len(got) < 4 + 25000:
            opcode, payload = await read_server_frame(reader)
            assert opcode == 2
            got += payload
        status = await rig.ctl("status")
        again_reader, again_writer = await rig.raw(rig.upgrade(grant["token"]))
        again = await status_line(again_reader)
        again_writer.close()
        writer.close()
        return line, headers, got, status, again, b"".join(rig.received)
    line, headers, got, status, again, received = case(monkeypatch, body)
    assert line == "HTTP/1.1 101 Switching Protocols"
    assert headers["sec-websocket-accept"] == base64.b64encode(hashlib.sha1((SAMPLE_KEY + GUID).encode()).digest()).decode()
    assert headers["sec-websocket-protocol"] == "binary"
    assert received == b"hello" * 5000 and got.startswith(b"vnc:hello")
    assert status["view"] == "connected"
    assert again.startswith("HTTP/1.1 403"), "the token opens one connection, once"


@pytest.mark.parametrize("token", ["", "x", "a" * 42, "a" * 44, "a" * 43, "../" + "a" * 40, "a" * 42 + "!"])
def test_a_wrong_token_is_refused_and_does_not_use_the_good_one_up(monkeypatch, token):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(token))
        line = await status_line(reader)
        writer.close()
        good_reader, good_writer = await rig.raw(rig.upgrade(grant["token"]))
        good = await status_line(good_reader)
        good_writer.close()
        return line, good
    line, good = case(monkeypatch, body)
    assert line.startswith(("HTTP/1.1 403", "HTTP/1.1 404")) and good.startswith("HTTP/1.1 101")


def test_anything_that_is_not_a_websocket_opening_with_the_token_is_a_fixed_404_and_does_not_use_the_token_up(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        token = grant["token"]
        lines = []
        for raw in (
            f"GET /websockify?token={token} HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
            f"POST /websockify?token={token} HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
            f"GET /other?token={token} HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
            f"GET /websockify?token={token}&x=1 HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
            f"GET /websockify HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
            rig.upgrade(token, key="not-base64"),
            rig.upgrade(token).replace(b"Version: 13", b"Version: 12"),
            b"GARBAGE\r\n\r\n",
            b"GET /websockify?token=" + token.encode() + b" HTTP/1.1\r\n" + b"X: y\r\n" * 60 + b"\r\n",
        ):
            reader, writer = await rig.raw(raw)
            lines.append(await status_line(reader))
            writer.close()
        reader, writer = await rig.raw(rig.upgrade(token))
        good = await status_line(reader)
        writer.close()
        return lines, good
    lines, good = case(monkeypatch, body)
    assert all(line == "HTTP/1.1 404 Not Found" for line in lines), lines
    assert good.startswith("HTTP/1.1 101")


def test_a_token_that_is_late_is_refused_and_the_view_ends_with_the_code_of_token_expired(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        rig.clock[0] = 121.0
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        line = await status_line(reader)
        writer.close()
        return line, await asyncio.wait_for(rig.task, 5)
    line, code = case(monkeypatch, body)
    assert line.startswith("HTTP/1.1 403") and code == 12


def test_a_token_that_is_never_used_ends_the_view_with_token_expired(monkeypatch):
    async def body(rig):
        await rig.ctl("grant")
        rig.clock[0] = 125.0
        return await asyncio.wait_for(rig.task, 5)
    assert case(monkeypatch, body) == 12


def test_a_grant_after_the_token_is_late_says_token_expired(monkeypatch):
    async def body(rig):
        rig.clock[0] = 130.0
        return await rig.ctl("grant")
    assert case(monkeypatch, body) == {"ok": False, "reason": "token_expired"}


def test_the_whole_container_ends_at_the_limit_of_its_life(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        rig.clock[0] = lv.LIFE_SECONDS + 1
        code = await asyncio.wait_for(rig.task, 5)
        writer.close()
        return code
    assert case(monkeypatch, body) == 11


def test_the_session_ends_with_login_timeout_after_fifteen_minutes_from_the_connection(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        rig.clock[0] = 50.0
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        rig.clock[0] = 50.0 + lv.SESSION_SECONDS + 1
        code = await asyncio.wait_for(rig.task, 6)
        writer.close()
        return code
    assert case(monkeypatch, body) == 11


def test_the_hint_that_the_login_is_done_ends_the_session_as_logged_in(monkeypatch):
    async def body(rig):
        monkeypatch.setattr(lv.asyncio, "sleep", _fast_sleep(lv.asyncio.sleep))
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        rig.hint.write_text("logged_in\n")
        code = await asyncio.wait_for(rig.task, 8)
        writer.close()
        return code
    assert case(monkeypatch, body) == 10


def _fast_sleep(real):
    async def sleep(seconds, *args):
        await real(min(seconds, 0.05), *args)
    return sleep


@pytest.mark.parametrize("content", ["something else", "logged_in" * 10, "LOGGED_IN", "", "sandbox_failed\nlogged_in"])
def test_a_hint_that_is_not_from_the_closed_list_or_is_too_big_is_ignored(tmp_path, content):
    view = lv.View(str(tmp_path / "v"), str(tmp_path / "hint"))
    (tmp_path / "hint").write_text(content)
    assert view.read_hint() is None


def test_a_hint_that_is_a_link_or_a_folder_is_ignored(tmp_path):
    view = lv.View(str(tmp_path / "v"), str(tmp_path / "hint"))
    real = tmp_path / "real"
    real.write_text("logged_in")
    (tmp_path / "hint").symlink_to(real)
    assert view.read_hint() is None
    (tmp_path / "hint").unlink()
    (tmp_path / "hint").mkdir()
    assert view.read_hint() is None
    (tmp_path / "hint").rmdir()
    (tmp_path / "hint").write_text("logged_in\n")
    assert view.read_hint() == "logged_in"


@pytest.mark.parametrize("raw", [
    mask_frame(2, b"x", masked=False),             # a client that does not mask
    mask_frame(1, b"text"),                        # text: noVNC speaks binary
    mask_frame(3, b"x"),                           # a reserved opcode
    bytes([0xC2, 0x81]) + b"\x00\x00\x00\x00x",   # an extension bit
    bytes([0x82, 0xFF]) + struct.pack(">Q", 2**40) + b"\x00\x00\x00\x00",  # a size far above the limit
    mask_frame(9, b"x" * 200),                     # a ping that is too long
    mask_frame(8, b"", fin=False),                 # a fragmented close
])
def test_a_frame_that_noVNC_would_never_send_ends_the_connection_and_forwards_nothing(monkeypatch, raw):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        writer.write(raw)
        await writer.drain()
        data = await asyncio.wait_for(reader.read(65536), 5)  # a close frame, then the end
        writer.close()
        return data, b"".join(rig.received)
    data, received = case(monkeypatch, body)
    assert received == b""
    assert data[:1] == b"\x88" or data == b""


def test_ping_is_answered_with_pong_and_close_ends_the_session_as_stopped(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        writer.write(mask_frame(9, b"abc"))
        await writer.drain()
        pong = await read_server_frame(reader)
        writer.write(mask_frame(8, b""))
        await writer.drain()
        code = await asyncio.wait_for(rig.task, 5)
        writer.close()
        return pong, code
    pong, code = case(monkeypatch, body)
    assert pong == (10, b"abc") and code == 13


def test_a_browser_that_goes_away_ends_the_session_as_stopped(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        await status_line(reader)
        await read_headers(reader)
        rig.vnc_server.close()
        # the fake server closes its sockets when the client writes after the server closed: force the end from the browser side
        writer.write(mask_frame(8, b""))
        await writer.drain()
        code = await asyncio.wait_for(rig.task, 5)
        writer.close()
        return code
    assert case(monkeypatch, body) == 13


def test_a_connection_when_the_browser_socket_cannot_be_opened_is_502_and_unavailable(monkeypatch):
    async def body(rig):
        grant = await rig.ctl("grant")
        # the socket is there for the grant (a file of the right kind) but nobody listens
        rig.vnc_server.close()
        reader, writer = await rig.raw(rig.upgrade(grant["token"]))
        line = await status_line(reader)
        writer.close()
        return line, await asyncio.wait_for(rig.task, 5)
    line, code = case(monkeypatch, body)
    assert line.startswith("HTTP/1.1 502") and code == 14


def test_stop_through_the_control_socket_ends_the_view_as_stopped_and_an_unknown_word_is_unavailable(monkeypatch):
    async def body(rig):
        unknown = await rig.ctl("open")
        stopped = await rig.ctl("stop")
        return unknown, stopped, await asyncio.wait_for(rig.task, 5)
    unknown, stopped, code = case(monkeypatch, body)
    assert unknown == {"ok": False, "reason": "view_unavailable"} and stopped == {"ok": True} and code == 13


def test_the_control_socket_is_private(monkeypatch):
    async def body(rig):
        return os.stat(rig.control).st_mode & 0o777
    assert case(monkeypatch, body) == 0o600


def test_the_docker_exec_side_prints_the_answer_and_says_unavailable_when_nobody_listens(tmp_path, capsys):
    token = lv.new_token()
    assert lv.ask("grant", str(tmp_path / "none.sock"), io.StringIO(token + "\n")) == 1
    out = capsys.readouterr().out
    assert json.loads(out) == {"ok": False, "reason": "view_unavailable"} and token not in out
    assert lv.main(["frobnicate"]) == 2 and lv.main([]) == 2


@pytest.mark.parametrize("text", ["", "\n", "short\n", "a" * 44 + "\n", "a" * 42 + "!\n"])
def test_the_docker_exec_side_asks_nothing_without_a_well_formed_token_on_its_stdin(tmp_path, capsys, text):
    assert lv.ask("grant", str(tmp_path / "none.sock"), io.StringIO(text)) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "reason": "token_required"}


def test_the_command_as_docker_exec_runs_it_takes_the_token_on_a_real_stdin_and_prints_none(monkeypatch):
    """`docker exec -i … login_view.py grant`: a process of its own, the token on a pipe, the answer on stdout."""
    import subprocess
    import sys

    async def body(rig):
        token = lv.new_token()
        done = await asyncio.to_thread(
            subprocess.run, [sys.executable, "-I", str(Path(lv.__file__)), "grant", rig.control],
            input=(token + "\n").encode(), capture_output=True, timeout=20)
        # the token the process brought is the one that opens the window
        reader, writer = await rig.raw(rig.upgrade(token))
        status = await status_line(reader)
        writer.close()
        return token, done, status
    token, done, status = case(monkeypatch, body)
    assert done.returncode == 0 and token.encode() not in done.stdout + done.stderr
    assert json.loads(done.stdout)["ok"] is True and " 101 " in status


def test_the_docker_exec_side_never_prints_the_token_it_carries(monkeypatch, tmp_path, capsys):
    async def body(rig):
        token = lv.new_token()
        done = await asyncio.to_thread(lv.ask, "grant", rig.control, io.StringIO(token + "\n"))
        return token, done
    token, done = case(monkeypatch, body)
    out = capsys.readouterr().out
    assert done == 0 and json.loads(out)["ok"] is True and token not in out


def test_the_frame_helper_writes_the_three_sizes_unmasked():
    assert lv.frame(2, b"a") == b"\x82\x01a"
    assert lv.frame(2, b"a" * 200)[:4] == b"\x82\x7e\x00\xc8"
    assert lv.frame(2, b"a" * 70000)[:2] == b"\x82\x7f"


@pytest.mark.parametrize(("hint", "reason"), [("sandbox_failed", "chromium_sandbox_unavailable"), ("browser_failed", "view_unavailable")])
def test_a_browser_that_did_not_start_makes_the_grant_say_why_in_the_words_of_the_contract(monkeypatch, hint, reason):
    async def body(rig):
        rig.hint.write_text(hint + "\n")
        return await rig.ctl("grant")
    assert case(monkeypatch, body) == {"ok": False, "reason": reason}
