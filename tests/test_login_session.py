"""shared/login/login_session.py: the browser of the LinkedIn login, in the container that has no network. The command lines (the sandbox is
on, no name is resolved here, everything goes to the proxy), the cookie watcher (a name and an expiry, never a value), the hint written
whole, the relay that only moves bytes, and the supervisor with fake programs on the PATH."""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sqlite3
import stat
import sys
import tempfile
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("login_session", ROOT / "shared" / "login" / "login_session.py")
ls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ls)

NOW_US = 13_400_000_000_000_000  # a moment of Chromium's clock


def make_cookies(path: Path, rows: list[tuple[str, str, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER)")
    for host, name, expires in rows:
        db.execute("INSERT INTO cookies VALUES (?, ?, ?, ?, ?)", (host, name, "NOT-READ", b"NOT-READ", expires))
    db.commit()
    db.close()


def test_chromium_keeps_its_sandbox_goes_through_the_relay_and_resolves_no_name():
    command = ls.chromium_command("/linkedin-profile")
    assert "--no-sandbox" not in command and "--disable-setuid-sandbox" not in command
    assert "--user-data-dir=/linkedin-profile" in command
    assert "--proxy-server=http://127.0.0.1:3128" in command
    assert any(item.startswith("--host-resolver-rules=MAP * ~NOTFOUND") and "EXCLUDE 127.0.0.1" in item for item in command)
    assert command[-1] == "https://www.linkedin.com/login"
    assert "--remote-debugging-port" not in " ".join(command) and "--remote-debugging-pipe" not in command


def test_x11vnc_listens_on_the_shared_socket_and_the_loopback_only_and_is_not_view_only():
    command = ls.x11vnc_command("/ipc/vnc.sock")
    assert command[command.index("-unixsock") + 1] == "/ipc/vnc.sock" and "-localhost" in command
    assert "-viewonly" not in command and "-nopw" in command
    assert command[command.index("-display") + 1] == ":97"


@pytest.mark.parametrize("layout", ["Default/Network/Cookies", "Default/Cookies"])
def test_the_session_cookie_of_linkedin_in_the_profile_means_logged_in_in_both_layouts_of_chromium(tmp_path, layout):
    assert not ls.logged_in(str(tmp_path), NOW_US)
    make_cookies(tmp_path / layout, [(".linkedin.com", "li_at", NOW_US + 10**12)])
    assert ls.logged_in(str(tmp_path), NOW_US)


@pytest.mark.parametrize("rows", [
    [(".linkedin.com", "li_at", NOW_US - 1)],                     # it has run out
    [(".linkedin.com", "li_rm", NOW_US + 10**12)],                # another cookie
    [(".example.com", "li_at", NOW_US + 10**12)],                 # another site
    [(".evillinkedin.com", "li_at", NOW_US + 10**12)],            # a site that only ends like it
    [("linkedin.com.evil.test", "li_at", NOW_US + 10**12)],
    [],
])
def test_a_cookie_that_is_not_the_live_session_of_linkedin_is_not_a_login(tmp_path, rows):
    make_cookies(tmp_path / "Default" / "Network" / "Cookies", rows)
    assert not ls.logged_in(str(tmp_path), NOW_US)


def test_a_cookie_without_an_expiry_is_a_session_cookie_and_counts(tmp_path):
    make_cookies(tmp_path / "Default" / "Network" / "Cookies", [("www.linkedin.com", "li_at", 0)])
    assert ls.logged_in(str(tmp_path), NOW_US)


def test_a_broken_or_linked_cookie_file_is_not_a_login_and_not_an_error(tmp_path):
    folder = tmp_path / "Default" / "Network"
    folder.mkdir(parents=True)
    (folder / "Cookies").write_bytes(b"not a database")
    assert not ls.logged_in(str(tmp_path), NOW_US)
    (folder / "Cookies").unlink()
    real = tmp_path / "real.db"
    make_cookies(real, [(".linkedin.com", "li_at", NOW_US + 10**12)])
    (folder / "Cookies").symlink_to(real)
    assert not ls.logged_in(str(tmp_path), NOW_US), "a link is not followed"


def test_the_value_of_the_cookie_is_never_read(tmp_path, monkeypatch):
    make_cookies(tmp_path / "Default" / "Network" / "Cookies", [(".linkedin.com", "li_at", NOW_US + 10**12)])
    seen = []
    real = sqlite3.connect
    class Spy:
        def __init__(self, inner): self.inner = inner
        def execute(self, sql, params=()):
            seen.append(sql)
            return self.inner.execute(sql, params)
        def close(self): self.inner.close()
    monkeypatch.setattr(ls.sqlite3, "connect", lambda *a, **k: Spy(real(*a, **k)))
    assert ls.logged_in(str(tmp_path), NOW_US)
    assert seen and all("value" not in sql.lower() for sql in seen)


def test_the_hint_is_written_whole_and_replaces_the_one_before(tmp_path):
    path = tmp_path / "hint"
    ls.write_hint(str(path), "browser_failed")
    ls.write_hint(str(path), "logged_in")
    assert path.read_text() == "logged_in\n" and not (tmp_path / "hint.part").exists()


def test_the_relay_moves_bytes_between_the_loopback_and_the_socket_of_the_proxy_and_reads_nothing():
    async def go():
        folder = tempfile.mkdtemp(prefix="ls", dir="/tmp")
        proxy_path = os.path.join(folder, "proxy.sock")
        got = []
        async def proxy(reader, writer):
            data = await reader.read(100)
            got.append(data)
            writer.write(b"from-proxy:" + data)
            await writer.drain()
            writer.close()
        proxy_server = await asyncio.start_unix_server(proxy, path=proxy_path)
        import socket
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        server = await ls.relay("127.0.0.1", port, proxy_path)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"CONNECT x:443 HTTP/1.1\r\n\r\n")
        await writer.drain()
        answer = await asyncio.wait_for(reader.read(200), 5)
        writer.close()
        server.close()
        proxy_server.close()
        return got, answer
    got, answer = asyncio.run(go())
    assert got == [b"CONNECT x:443 HTTP/1.1\r\n\r\n"] and answer == b"from-proxy:CONNECT x:443 HTTP/1.1\r\n\r\n"


def test_a_relay_whose_proxy_is_not_there_closes_the_connection_with_nothing_said():
    async def go():
        import socket
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        server = await ls.relay("127.0.0.1", port, "/tmp/definitely-not-here.sock")
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"x")
        try:
            data = await asyncio.wait_for(reader.read(100), 5)
        except ConnectionError:
            data = b""  # closed with the bytes unread: a reset, which is how a closed door looks
        writer.close()
        server.close()
        return data
    assert asyncio.run(go()) == b""


# ---- the supervisor, with fake programs ----

FAKE = """#!/usr/bin/env python3
import os, socket, sys, time
name = os.path.basename(sys.argv[0])
log = os.environ["FAKE_LOG"]
with open(log, "a") as f:
    f.write(name + " " + " ".join(sys.argv[1:]) + "\\n")
if name == "Xvfb":
    os.makedirs("/tmp/.X11-unix", exist_ok=True)
    s = socket.socket(socket.AF_UNIX)
    path = "/tmp/.X11-unix/X97"
    try:
        os.unlink(path)
    except OSError:
        pass
    s.bind(path)
elif name == "x11vnc":
    s = socket.socket(socket.AF_UNIX)
    path = sys.argv[sys.argv.index("-unixsock") + 1]
    s.bind(path)
elif name == "chromium":
    mode = os.environ.get("FAKE_CHROMIUM", "stay")
    if mode == "sandbox":
        sys.stderr.write("FATAL: No usable sandbox! Update your kernel\\n"); sys.exit(1)
    if mode == "crash":
        sys.stderr.write("something else\\n"); sys.exit(1)
time.sleep(float(os.environ.get("FAKE_LIFE", "60")))
"""


@pytest.fixture
def fakes(tmp_path, monkeypatch):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for name in ("Xvfb", "openbox", "x11vnc", "chromium"):
        path = bindir / name
        path.write_text(FAKE, encoding="utf-8")
        path.chmod(0o755)
    log = tmp_path / "log"
    log.write_text("")
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setattr(ls, "POLL_SECONDS", 0.2)
    monkeypatch.setattr(ls, "AFTER_LOGIN_SECONDS", 0.5)
    monkeypatch.setattr(ls, "SOCKET_WAIT_SECONDS", 5)
    monkeypatch.setattr(ls, "RELAY_PORT", _free_port())
    short = Path(tempfile.mkdtemp(prefix="lsx", dir="/tmp"))
    return type("F", (), {"log": log, "dir": short, "profile": tmp_path / "profile", "bin": bindir})


def _free_port() -> int:
    import socket
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _run(f, **kw):
    return asyncio.run(ls.run(str(f.dir / "vnc.sock"), str(f.dir / "proxy.sock"), str(f.dir / "hint"), str(f.profile)))


@pytest.mark.skipif(sys.platform == "win32", reason="unix sockets and programs on the PATH")
def test_the_supervisor_starts_the_four_programs_in_order_and_ends_when_the_login_is_done(fakes, monkeypatch):
    make_cookies(fakes.profile / "Default" / "Network" / "Cookies", [(".linkedin.com", "li_at", int(time.time() * 1e6) + ls.CHROME_UNIX_EPOCH_US + 10**12)])
    code = _run(fakes)
    lines = fakes.log.read_text().splitlines()
    assert code == 0
    assert [line.split()[0] for line in lines] == ["Xvfb", "openbox", "chromium", "x11vnc"]
    assert (fakes.dir / "hint").read_text() == "logged_in\n"
    assert "-nolisten tcp" in lines[0]


@pytest.mark.skipif(sys.platform == "win32", reason="unix sockets and programs on the PATH")
@pytest.mark.parametrize(("mode", "word"), [("sandbox", "sandbox_failed"), ("crash", "browser_failed")])
def test_a_browser_that_ends_at_once_leaves_the_reason_in_the_hint_from_a_closed_list(fakes, monkeypatch, mode, word):
    monkeypatch.setenv("FAKE_CHROMIUM", mode)
    assert _run(fakes) == 8
    assert (fakes.dir / "hint").read_text() == word + "\n"


@pytest.mark.skipif(sys.platform == "win32", reason="unix sockets and programs on the PATH")
def test_the_supervisor_stops_what_it_started_when_it_ends(fakes, monkeypatch):
    monkeypatch.setenv("FAKE_CHROMIUM", "crash")
    _run(fakes)
    time.sleep(0.3)
    left = os.popen(f"pgrep -f '{fakes.bin}/' 2>/dev/null").read().split()
    assert left == []


def test_the_main_refuses_the_wrong_number_of_arguments():
    assert ls.main([]) == 2 and ls.main(["a", "b", "c"]) == 2


def test_check_prints_one_word_from_the_closed_list(tmp_path, capsys):
    assert ls.main(["check", str(tmp_path)]) == 0
    make_cookies(tmp_path / "Default" / "Network" / "Cookies", [(".linkedin.com", "li_at", 0)])
    assert ls.main(["check", str(tmp_path)]) == 0
    assert capsys.readouterr().out.split() == ["login_required", "logged_in"]
