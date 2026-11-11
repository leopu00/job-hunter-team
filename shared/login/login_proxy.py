"""The only way out of the browser of the LinkedIn login: a CONNECT proxy that listens on a unix socket and lets through a short list.

The container that holds the browser (`jht-login`) has no network at all. Its relay hands every connection of the browser to the socket
of this proxy, which runs in a container of its own (`jht-login-proxy`) that has a network and nothing else: no profile, no display, no
port. It sees bytes of TLS, never a password typed (those go to the view, another container).

What it lets through, and nothing else:
  - the method CONNECT, to port 443;
  - a host of the list (allowed_hosts.txt: a line `a.b.c` is that host, a line `.b.c` is any host below b.c), written as a name: never
    an address, never a name with anything but letters, digits, dots and hyphens;
  - to ONE address, resolved here once for the connection: a global address (not private, loopback, link-local, carrier-grade NAT,
    unique-local, multicast, reserved, the metadata address, nor an IPv4 address inside an IPv6 one).
Limits: size of the request, time to send it, connections at once, idle time, time and bytes of each connection. Whatever goes wrong the
browser gets a fixed line with a code: no text of an error ever leaves this module.

The list is data, measured with a real run of the pages (see the plan of the login); TLS is not inspected here, so a host of the list can
carry any content: that is the residue, and the reason the list is short.

    python3 login_proxy.py <socket path> [<allowed hosts file>]
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import socket
import sys
from pathlib import Path

DEFAULT_LIST = Path(__file__).with_name("allowed_hosts.txt")
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
MAX_REQUEST_BYTES = 4096
MAX_HEADER_LINES = 32
REQUEST_SECONDS = 10
CONNECT_SECONDS = 10
IDLE_SECONDS = 120
MAX_CONNECTIONS = 64
MAX_CONNECTION_SECONDS = 15 * 60
MAX_CONNECTION_BYTES = 256 * 1024 * 1024
CHUNK = 65536


def parse_list(text: str) -> tuple[frozenset[str], tuple[str, ...]]:
    """(exact hosts, suffixes with their leading dot). A line that is not a name is an error: a list is read whole or not at all."""
    exact: set[str] = set()
    suffixes: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip().lower()
        if not line:
            continue
        name = line[1:] if line.startswith(".") else line
        if not HOST_RE.fullmatch(name):
            raise ValueError("a line of the list is not a host name")
        if line.startswith("."):
            suffixes.append(line)
        else:
            exact.add(line)
    return frozenset(exact), tuple(suffixes)


def load_list(path: Path = DEFAULT_LIST) -> tuple[frozenset[str], tuple[str, ...]]:
    return parse_list(path.read_text(encoding="utf-8"))


def host_allowed(host: str, exact: frozenset[str], suffixes: tuple[str, ...]) -> bool:
    host = host.lower()
    if host.endswith("."):
        host = host[:-1]
    if len(host) > 253 or not HOST_RE.fullmatch(host):
        return False  # also every address written as digits: no label of a name can be all digits at the end of an IPv4 literal
    if re.fullmatch(r"[0-9.]+", host):
        return False
    return host in exact or any(host.endswith(suffix) for suffix in suffixes)


def address_allowed(text: str) -> bool:
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return address_allowed(str(address.ipv4_mapped))
        if address in ipaddress.ip_network("64:ff9b::/96") or address in ipaddress.ip_network("64:ff9b:1::/48"):
            return False  # NAT64: it reaches an IPv4 address of the network behind it
        if address in ipaddress.ip_network("2002::/16"):
            return False  # 6to4: carries an IPv4 address
        if address in ipaddress.ip_network("2001::/32"):
            return False  # Teredo
    if address in ipaddress.ip_network((0x64400000, 10)):
        return False  # carrier-grade NAT (the range 100.64/10, written as the number of its first address)
    return bool(address.is_global) and not (address.is_multicast or address.is_loopback or address.is_link_local)


def parse_connect(line: bytes) -> tuple[str, int] | None:
    """`CONNECT host:port HTTP/1.x` → (host, port); anything else is None."""
    try:
        text = line.decode("ascii")
    except UnicodeDecodeError:
        return None
    parts = text.rstrip("\r\n").split(" ")
    if len(parts) != 3 or parts[0] != "CONNECT" or parts[2] not in ("HTTP/1.1", "HTTP/1.0"):
        return None
    target = parts[1]
    if target.count(":") != 1:
        return None
    host, port = target.split(":")
    if not port.isdigit() or len(port) > 5:
        return None
    return host, int(port)


def reply(code: int, text: str) -> bytes:
    return f"HTTP/1.1 {code} {text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".encode("ascii")


class Proxy:
    def __init__(self, exact: frozenset[str], suffixes: tuple[str, ...], resolve=None) -> None:
        self.exact, self.suffixes = exact, suffixes
        self.active = 0
        self._resolve = resolve or self._getaddrinfo

    @staticmethod
    async def _getaddrinfo(host: str) -> list[str]:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        return [info[4][0] for info in infos]

    async def _read_request(self, reader: asyncio.StreamReader) -> tuple[str, int] | int:
        """(host, port) of a well-formed CONNECT, or the code to answer with."""
        try:
            line = await asyncio.wait_for(reader.readline(), REQUEST_SECONDS)
            if len(line) > MAX_REQUEST_BYTES or not line.endswith(b"\n"):
                return 400
            seen, size = 0, len(line)
            while True:
                header = await asyncio.wait_for(reader.readline(), REQUEST_SECONDS)
                size += len(header)
                seen += 1
                if size > MAX_REQUEST_BYTES or seen > MAX_HEADER_LINES or not header.endswith(b"\n"):
                    return 400
                if header in (b"\r\n", b"\n"):
                    break
        except (asyncio.TimeoutError, asyncio.LimitOverrunError, ConnectionError, ValueError):
            return 400
        target = parse_connect(line)
        if target is None:
            return 405
        return target

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            if self.active >= MAX_CONNECTIONS:
                writer.write(reply(503, "Busy"))
                return
            self.active += 1
            try:
                await self._serve(reader, writer)
            finally:
                self.active -= 1
        except Exception:  # whatever it was, the browser gets nothing about it
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = await self._read_request(reader)
        if isinstance(request, int):
            writer.write(reply(request, "Refused"))
            await writer.drain()
            return
        host, port = request
        if port != 443 or not host_allowed(host, self.exact, self.suffixes):
            writer.write(reply(403, "Forbidden"))
            await writer.drain()
            return
        try:
            candidates = await asyncio.wait_for(self._resolve(host.lower().rstrip(".")), CONNECT_SECONDS)
        except Exception:
            writer.write(reply(502, "Unreachable"))
            await writer.drain()
            return
        usable = [address for address in candidates if address_allowed(address)]
        if not usable or len(usable) != len(candidates):
            # a name with even one address that is not global is refused whole: no choosing among its addresses
            writer.write(reply(403, "Forbidden"))
            await writer.drain()
            return
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(usable[0], 443), CONNECT_SECONDS)
        except Exception:
            writer.write(reply(502, "Unreachable"))
            await writer.drain()
            return
        try:
            writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
            await writer.drain()
            budget = [MAX_CONNECTION_BYTES]
            await asyncio.wait_for(
                asyncio.gather(self._pump(reader, up_writer, budget), self._pump(up_reader, writer, budget)),
                MAX_CONNECTION_SECONDS,
            )
        except Exception:
            pass
        finally:
            up_writer.close()

    @staticmethod
    async def _pump(source: asyncio.StreamReader, target: asyncio.StreamWriter, budget: list[int]) -> None:
        try:
            while budget[0] > 0:
                data = await asyncio.wait_for(source.read(CHUNK), IDLE_SECONDS)
                if not data:
                    break
                budget[0] -= len(data)
                target.write(data)
                await target.drain()
        except Exception:
            pass
        finally:
            try:
                target.close()
            except Exception:
                pass


async def serve(path: str, exact: frozenset[str], suffixes: tuple[str, ...]) -> None:
    proxy = Proxy(exact, suffixes)
    old = os.umask(0o177)
    try:
        if os.path.lexists(path):
            os.unlink(path)
        server = await asyncio.start_unix_server(proxy.handle, path=path, limit=MAX_REQUEST_BYTES * 2)
    finally:
        os.umask(old)
    async with server:
        await server.serve_forever()


def main(argv: list[str]) -> int:
    if len(argv) not in (1, 2):
        print("usage: login_proxy.py <socket path> [<allowed hosts file>]", file=sys.stderr)
        return 2
    try:
        exact, suffixes = load_list(Path(argv[1]) if len(argv) == 2 else DEFAULT_LIST)
    except (OSError, ValueError):
        print("login-proxy: the list of hosts cannot be read", file=sys.stderr)
        return 3
    if not exact and not suffixes:
        print("login-proxy: the list of hosts is empty", file=sys.stderr)
        return 3
    try:
        asyncio.run(serve(argv[0], exact, suffixes))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
