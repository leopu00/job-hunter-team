"""shared/login/login_proxy.py: the only way out of the browser of the LinkedIn login. A short list of names, port 443, one resolved
address that is global, limits, and a fixed answer for everything else. Made-up names and a local echo server stand for the network."""
from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import os
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("login_proxy", ROOT / "shared" / "login" / "login_proxy.py")
proxy_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy_module)

LIST = """
# the sign-in of the site
www.example-site.test
.example-site.test
.accounts.example-auth.test   # the sign-in with the account
"""
EXACT, SUFFIXES = proxy_module.parse_list(LIST)
PUBLIC = str(ipaddress.ip_address(0x08080808))      # an address that is global, written as a number: no address of a real host in a file of the repository
PUBLIC_B = str(ipaddress.ip_address(0x08080404))


@pytest.mark.parametrize("host", ["www.example-site.test", "WWW.EXAMPLE-SITE.TEST", "a.example-site.test", "x.y.example-site.test",
                                  "www.example-site.test.", "login.accounts.example-auth.test"])
def test_a_name_of_the_list_is_allowed(host):
    assert proxy_module.host_allowed(host, EXACT, SUFFIXES)


@pytest.mark.parametrize("host", [
    "evil-example-site.test", "example-site.test.evil.test", "example-site.test", "accounts.example-auth.test", "www.example-site.test.evil.test",
    "127.0.0.1", "10.0.0.1", "2130706433", "0x7f.0.0.1", "[::1]", "::1", "", ".", "..", "a b.example-site.test", "a" + "@" + "example-site.test",
    "www.example-site.test:443", "exämple-site.test", "www.example-site.test\n", "-www.example-site.test", "x" * 70 + ".example-site.test",
])
def test_everything_else_is_refused(host):
    assert not proxy_module.host_allowed(host, EXACT, SUFFIXES)


@pytest.mark.parametrize("line", ["www.example-site.test:443", "not a name", ".", "a_b.example.test", "x.test/path", "ex ample.test"])
def test_a_list_with_a_line_that_is_not_a_name_is_refused_whole(line):
    with pytest.raises(ValueError):
        proxy_module.parse_list("good.example.test\n" + line + "\n")


@pytest.mark.parametrize("address", [
    PUBLIC, PUBLIC_B, "2606:4700:4700::1111", "2a00:1450:4001:81b::200e",
])
def test_a_global_address_is_allowed(address):
    assert proxy_module.address_allowed(address)


@pytest.mark.parametrize("address", [
    "127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "169.254.169.254", "169.254.0.1", str(ipaddress.ip_address(0x64400001)),
    str(ipaddress.ip_address(0x647FFFFE)), "0.0.0.0", "224.0.0.1", "255.255.255.255", str(ipaddress.ip_address(0xF0000001)), "192.0.2.1", "198.51.100.1", "203.0.113.1", str(ipaddress.ip_address(0xC6120001)),
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "not an address", "", "1.2.3", PUBLIC + "/32",
])
def test_every_address_that_is_not_global_is_refused(address):
    assert not proxy_module.address_allowed(address)


@pytest.mark.parametrize(("line", "expected"), [
    (b"CONNECT www.example-site.test:443 HTTP/1.1\r\n", ("www.example-site.test", 443)),
    (b"CONNECT a.b:80 HTTP/1.0\r\n", ("a.b", 80)),
    (b"GET http://www.example-site.test/ HTTP/1.1\r\n", None),
    (b"CONNECT www.example-site.test HTTP/1.1\r\n", None),
    (b"CONNECT www.example-site.test:443:1 HTTP/1.1\r\n", None),
    (b"CONNECT www.example-site.test:abc HTTP/1.1\r\n", None),
    (b"CONNECT www.example-site.test:443 HTTP/2\r\n", None),
    (b"connect www.example-site.test:443 HTTP/1.1\r\n", None),
    (b"CONNECT  www.example-site.test:443 HTTP/1.1\r\n", None),
    (b"CONNECT \xc3\xa9.test:443 HTTP/1.1\r\n", None),
    (b"CONNECT a.b:4430000 HTTP/1.1\r\n", None),
])
def test_only_a_plain_connect_is_read(line, expected):
    assert proxy_module.parse_connect(line) == expected


# ---- the server, over a unix socket, with a local echo server as the network ----

async def _echo_server():
    async def echo(reader, writer):
        data = await reader.read(100)
        writer.write(b"echo:" + data)
        await writer.drain()
        writer.close()
    server = await asyncio.start_server(echo, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


class _Setup:
    def __init__(self, resolve, monkeypatch, upstream_port):
        self.resolve = resolve
        self.path = os.path.join(tempfile.mkdtemp(prefix="lp", dir="/tmp"), "p.sock")
        self.monkeypatch = monkeypatch
        self.upstream_port = upstream_port
        self.connected = []

    async def __aenter__(self):
        real = asyncio.open_connection
        async def fake(host, port, **kwargs):
            self.connected.append((host, port))
            return await real("127.0.0.1", self.upstream_port)
        self.monkeypatch.setattr(proxy_module.asyncio, "open_connection", fake)
        self.proxy = proxy_module.Proxy(EXACT, SUFFIXES, resolve=self.resolve)
        self.server = await asyncio.start_unix_server(self.proxy.handle, path=self.path, limit=8192)
        return self

    async def __aexit__(self, *exc):
        self.server.close()
        await self.server.wait_closed()

    async def ask(self, raw: bytes, expect_tunnel: bool = False) -> bytes:
        reader, writer = await asyncio.open_unix_connection(self.path)
        writer.write(raw)
        await writer.drain()
        first = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        rest = b""
        if expect_tunnel:
            writer.write(b"hello")
            await writer.drain()
            rest = await asyncio.wait_for(reader.read(100), 5)
        writer.close()
        return first + rest


def run(coro):
    return asyncio.run(coro)


def _case(monkeypatch, resolve, raw, tunnel=False):
    async def go():
        server, port = await _echo_server()
        try:
            async with _Setup(resolve, monkeypatch, port) as setup:
                answer = await setup.ask(raw, tunnel)
                return answer, setup.connected
        finally:
            server.close()
    return run(go())


async def _public(host):
    return [PUBLIC]


def test_a_name_of_the_list_is_tunnelled_to_the_one_address_resolved(monkeypatch):
    answer, connected = _case(monkeypatch, _public, b"CONNECT www.example-site.test:443 HTTP/1.1\r\nHost: x\r\n\r\n", tunnel=True)
    assert answer.startswith(b"HTTP/1.1 200") and answer.endswith(b"echo:hello")
    assert connected == [(PUBLIC, 443)], "the connection is to the address that was checked, never to the name again"


@pytest.mark.parametrize("raw", [
    b"CONNECT www.example-site.test:80 HTTP/1.1\r\n\r\n",
    b"CONNECT evil-example-site.test:443 HTTP/1.1\r\n\r\n",
    b"CONNECT example-site.test.evil.test:443 HTTP/1.1\r\n\r\n",
    b"CONNECT 127.0.0.1:443 HTTP/1.1\r\n\r\n",
    f"CONNECT {PUBLIC}:443 HTTP/1.1\r\n\r\n".encode(),
    b"CONNECT www.example-site.test:8443 HTTP/1.1\r\n\r\n",
])
def test_a_host_or_port_outside_the_rules_is_forbidden_and_nothing_is_resolved_or_connected(monkeypatch, raw):
    resolved = []
    async def resolve(host):
        resolved.append(host)
        return [PUBLIC]
    answer, connected = _case(monkeypatch, resolve, raw)
    assert answer.startswith(b"HTTP/1.1 403")
    assert resolved == [] and connected == []


@pytest.mark.parametrize("addresses", [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["::ffff:10.0.0.5"], [PUBLIC, "10.0.0.5"], []])
def test_a_name_that_resolves_to_something_that_is_not_global_is_refused_whole(monkeypatch, addresses):
    async def resolve(host):
        return addresses
    answer, connected = _case(monkeypatch, resolve, b"CONNECT www.example-site.test:443 HTTP/1.1\r\n\r\n")
    assert answer.startswith(b"HTTP/1.1 403") and connected == []


def test_a_name_that_does_not_resolve_is_a_fixed_502_with_no_text_of_the_error(monkeypatch):
    async def resolve(host):
        raise OSError("Name or service not known: secret-detail")
    answer, _ = _case(monkeypatch, resolve, b"CONNECT www.example-site.test:443 HTTP/1.1\r\n\r\n")
    assert answer.startswith(b"HTTP/1.1 502") and b"secret-detail" not in answer and b"Name or service" not in answer


@pytest.mark.parametrize("raw", [
    b"GET http://www.example-site.test/ HTTP/1.1\r\n\r\n",
    b"POST / HTTP/1.1\r\n\r\n",
    b"CONNECT www.example-site.test HTTP/1.1\r\n\r\n",
])
def test_anything_but_a_connect_is_405(monkeypatch, raw):
    answer, connected = _case(monkeypatch, _public, raw)
    assert answer.startswith(b"HTTP/1.1 405") and connected == []


def test_a_request_with_too_many_headers_or_too_long_is_400(monkeypatch):
    many = b"CONNECT www.example-site.test:443 HTTP/1.1\r\n" + b"X: y\r\n" * 40 + b"\r\n"
    answer, connected = _case(monkeypatch, _public, many)
    assert answer.startswith(b"HTTP/1.1 400") and connected == []
    long = b"CONNECT www.example-site.test:443 HTTP/1.1\r\nX: " + b"a" * 6000 + b"\r\n\r\n"
    answer, connected = _case(monkeypatch, _public, long)
    assert answer.startswith(b"HTTP/1.1 400") and connected == []


def test_the_server_socket_is_private_and_the_main_refuses_a_missing_or_empty_list(tmp_path):
    assert proxy_module.main([]) == 2
    assert proxy_module.main([str(tmp_path / "s"), str(tmp_path / "missing.txt")]) == 3
    empty = tmp_path / "empty.txt"
    empty.write_text("# nothing\n", encoding="utf-8")
    assert proxy_module.main([str(tmp_path / "s"), str(empty)]) == 3
    bad = tmp_path / "bad.txt"
    bad.write_text("good.test\nnot a name\n", encoding="utf-8")
    assert proxy_module.main([str(tmp_path / "s"), str(bad)]) == 3


def test_the_unix_socket_is_made_with_a_private_mode():
    async def go():
        path = os.path.join(tempfile.mkdtemp(prefix="lp", dir="/tmp"), "p.sock")
        task = asyncio.create_task(proxy_module.serve(path, EXACT, SUFFIXES))
        for _ in range(50):
            if os.path.exists(path):
                break
            await asyncio.sleep(0.02)
        mode = os.stat(path).st_mode & 0o777
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return mode
    assert run(go()) == 0o600


def test_the_list_that_ships_is_read_whole_has_no_wildcard_and_is_made_of_names_of_the_two_sites():
    exact, suffixes = proxy_module.load_list()
    assert exact and not suffixes, "exact names only: a wildcard needs a measurement that asks for it"
    assert {"www.linkedin.com", "accounts.google.com"} <= exact
    assert all(host.endswith(("linkedin.com", "licdn.com", "google.com", "gstatic.com", "youtube.com")) for host in exact)
    for refused in ("evil-linkedin.com", "linkedin.com.evil.test", "mail.google.com", "169.254.169.254", "localhost"):
        assert not proxy_module.host_allowed(refused, exact, suffixes)
