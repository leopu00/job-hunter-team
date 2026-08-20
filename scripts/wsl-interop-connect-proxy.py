#!/usr/bin/env python3
"""Local HTTP proxy that opens outbound sockets through Windows WSL interop."""

from __future__ import annotations

import argparse
import select
import socket
import socketserver
import subprocess
from urllib.parse import urlsplit


MAX_HEADER = 64 * 1024


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
                client.sendall(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
                return
            is_connect = parts[0].upper() == "CONNECT"
            if is_connect:
                host, port = parse_connect_target(parts[1])
                initial_data = b""
            else:
                target = urlsplit(parts[1])
                if target.scheme != "http" or not target.hostname:
                    client.sendall(b"HTTP/1.1 501 Unsupported Proxy Request\r\nConnection: close\r\n\r\n")
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
            process = subprocess.Popen(
                [self.server.connector, host, str(port)],  # type: ignore[attr-defined]
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            assert process.stdin is not None and process.stdout is not None
            ready = process.stdout.read(1)
            if ready != b"\x00":
                client.sendall(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
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
        except (OSError, ValueError, subprocess.SubprocessError):
            try:
                client.sendall(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
        finally:
            if process is not None and process.poll() is None:
                process.terminate()


class ThreadingProxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address: tuple[str, int], connector: str):
        self.connector = connector
        super().__init__(address, ProxyHandler)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bind",
        default="127.0.0.1",
        help="listen address (default: loopback only)",
    )
    parser.add_argument("--port", type=int, default=3128)
    parser.add_argument("--connector", required=True, help="WSL path to native Windows connector")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()

    with ThreadingProxy((args.bind, args.port), args.connector) as server:
        print(f"JHT_INTEROP_PROXY_READY http://{args.bind}:{args.port}", flush=True)
        server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
