#!/usr/bin/env python3
"""Local HTTP proxy that opens outbound sockets through Windows WSL interop."""

from __future__ import annotations

import argparse
import ipaddress
import select
import socket
import socketserver
import subprocess
from collections.abc import Callable, Sequence
from urllib.parse import urlsplit


MAX_HEADER = 64 * 1024
ALLOWED_PORTS = frozenset({80, 443, 465, 587, 993})
FORBIDDEN_V4 = tuple(
    ipaddress.ip_network(value)
    for value in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100." "64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "198." "18.0.0/15",
        "224.0.0.0/4",
        "240." "0.0.0/4",
    )
)
FORBIDDEN_V6 = tuple(
    ipaddress.ip_network(value)
    for value in (
        "::/128",
        "::1/128",
        "::ffff:0:0/96",
        "64:ff9b::/96",
        "fc00::/7",
        "fe80::/10",
        "ff00::/8",
    )
)


class PolicyDenied(ValueError):
    """The requested destination is outside the public egress policy."""


def read_header(client: socket.socket) -> bytes:
    data = bytearray()
    while b"\r\n\r\n" not in data:
        chunk = client.recv(4096)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > MAX_HEADER:
            raise ValueError("request header too large")
    return bytes(data)


def parse_connect_target(value: str) -> tuple[str, int]:
    parsed = urlsplit(f"//{value}")
    if not parsed.hostname:
        raise ValueError("missing CONNECT hostname")
    return parsed.hostname, parsed.port or 443


def forbidden_ip(value: str) -> bool:
    address = ipaddress.ip_address(value)
    networks = FORBIDDEN_V4 if address.version == 4 else FORBIDDEN_V6
    return any(address in network for network in networks)


Resolver = Callable[..., Sequence[tuple[int, int, int, str, tuple[object, ...]]]]


def resolve_public_target(
    host: str, port: int, resolver: Resolver = socket.getaddrinfo
) -> str:
    """Resolve once, reject the whole answer if any address is non-public."""
    normalized = host.rstrip(".").lower()
    if normalized == "localhost" or normalized.endswith((".localhost", ".local")):
        raise PolicyDenied("local hostname")
    if port not in ALLOWED_PORTS:
        raise PolicyDenied("port denied")

    answers = resolver(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    addresses: list[str] = []
    for family, socktype, protocol, _canonname, sockaddr in answers:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue
        if socktype != socket.SOCK_STREAM or protocol not in (0, socket.IPPROTO_TCP):
            continue
        address = str(ipaddress.ip_address(str(sockaddr[0])))
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise OSError("destination did not resolve to an IP address")
    if any(forbidden_ip(address) for address in addresses):
        raise PolicyDenied("non-public address")
    # The native connector receives the verified numeric address, never the
    # original hostname, so it cannot resolve a different answer later.
    return addresses[0]


def send_error(client: socket.socket, status: bytes) -> None:
    client.sendall(b"HTTP/1.1 " + status + b"\r\nConnection: close\r\n\r\n")


class ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        client: socket.socket = self.request
        client.settimeout(65)
        process: subprocess.Popen[bytes] | None = None
        try:
            header = read_header(client)
            first_line = header.split(b"\r\n", 1)[0].decode("ascii", "replace")
            parts = first_line.split(" ")
            if len(parts) != 3:
                send_error(client, b"400 Bad Request")
                return
            is_connect = parts[0].upper() == "CONNECT"
            if is_connect:
                host, port = parse_connect_target(parts[1])
                initial_data = b""
            else:
                target = urlsplit(parts[1])
                if target.scheme != "http" or not target.hostname:
                    send_error(client, b"501 Unsupported Proxy Request")
                    return
                host, port = target.hostname, target.port or 80
                path = target.path or "/"
                if target.query:
                    path += "?" + target.query
                initial_data = header.replace(
                    first_line.encode("ascii", "replace"),
                    f"{parts[0]} {path} {parts[2]}".encode("ascii"),
                    1,
                )
            resolved_ip = resolve_public_target(host, port, self.server.resolver)  # type: ignore[attr-defined]
            process = subprocess.Popen(
                [self.server.connector, resolved_ip, str(port)],  # type: ignore[attr-defined]
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            assert process.stdin is not None and process.stdout is not None
            ready = process.stdout.read(1)
            if ready != b"\x00":
                send_error(client, b"502 Bad Gateway")
                return
            if is_connect:
                client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            else:
                process.stdin.write(initial_data)
                process.stdin.flush()
            client.settimeout(None)

            while True:
                readable, _, _ = select.select([client, process.stdout], [], [], 65)
                if not readable:
                    break
                if client in readable:
                    data = client.recv(65536)
                    if not data:
                        break
                    process.stdin.write(data)
                    process.stdin.flush()
                if process.stdout in readable:
                    data = process.stdout.read(65536)
                    if not data:
                        break
                    client.sendall(data)
        except PolicyDenied:
            try:
                send_error(client, b"403 Forbidden")
            except OSError:
                pass
        except (OSError, ValueError, subprocess.SubprocessError):
            try:
                send_error(client, b"502 Bad Gateway")
            except OSError:
                pass
        finally:
            if process is not None and process.poll() is None:
                process.terminate()


class ThreadingProxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        connector: str,
        resolver: Resolver = socket.getaddrinfo,
    ):
        self.connector = connector
        self.resolver = resolver
        super().__init__(address, ProxyHandler)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bind",
        default="127.0.0.1",
        help="listen address (default: loopback only)",
    )
    parser.add_argument("--port", type=int, default=3128)
    parser.add_argument(
        "--connector", required=True, help="WSL path to native Windows connector"
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()

    with ThreadingProxy((args.bind, args.port), args.connector) as server:
        print(f"JHT_INTEROP_PROXY_READY http://{args.bind}:{args.port}", flush=True)
        server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
