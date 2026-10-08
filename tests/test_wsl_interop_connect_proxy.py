"""The Windows interop proxy is public-network-only, including after DNS."""

from __future__ import annotations

import importlib.util
import socket
import threading
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PROXY_PATH = ROOT / "scripts" / "wsl-interop-connect-proxy.py"
SPEC = importlib.util.spec_from_file_location("jht_wsl_interop_proxy", PROXY_PATH)
assert SPEC and SPEC.loader
PROXY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROXY)


def answers(*addresses: str):
    def resolve(_host, port, *, type, proto):
        assert type == socket.SOCK_STREAM
        assert proto == socket.IPPROTO_TCP
        result = []
        for address in addresses:
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            sockaddr = (
                (address, port, 0, 0) if family == socket.AF_INET6 else (address, port)
            )
            result.append(
                (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)
            )
        return result

    return resolve


@pytest.mark.parametrize(
    "address",
    [
        "0.1.2.3",
        "10.0.0.1",
        "100." "64.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "172.16.0.1",
        "192.168.1.1",
        "198." "18.0.1",
        "224.0.0.1",
        "240." "0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "fc00::1",
        "fe80::1",
        "ff00::1",
        "::ffff:127.0.0.1",
        "64:ff9b::7f00:1",
    ],
)
def test_every_non_public_address_class_is_denied(address):
    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target("destination.example", 443, answers(address))


@pytest.mark.parametrize(
    "host", ["localhost", "api.localhost", "printer.local", "LOCALHOST."]
)
def test_local_names_are_denied_without_dns(host):
    def must_not_resolve(*_args, **_kwargs):
        raise AssertionError("a local name reached DNS")

    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target(host, 443, must_not_resolve)


def test_one_private_dns_answer_denies_the_whole_name():
    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target(
            "rebinding.example",
            443,
            answers("192.0.2.10", "127.0.0.1"),
        )


def test_public_dns_is_resolved_once_and_returns_the_numeric_address():
    calls = []

    def resolve(*args, **kwargs):
        calls.append((args, kwargs))
        return answers("192.0.2.10")(*args, **kwargs)

    assert PROXY.resolve_public_target("example.com", 443, resolve) == "192.0.2.10"
    assert len(calls) == 1


def connector(tmp_path: Path) -> tuple[Path, Path]:
    marker = tmp_path / "connector-called"
    script = tmp_path / "connector"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import pathlib, sys\n"
        f"pathlib.Path({str(marker)!r}).write_text(' '.join(sys.argv[1:]))\n"
        "sys.stdout.buffer.write(b'\\x00'); sys.stdout.buffer.flush()\n"
        "sys.stdin.buffer.read()\n",
        encoding="utf-8",
    )
    script.chmod(0o700)
    return script, marker


def proxy_request(tmp_path: Path, target: str, resolver) -> tuple[bytes, Path]:
    executable, marker = connector(tmp_path)
    server = PROXY.ThreadingProxy(("127.0.0.1", 0), str(executable), resolver)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}
    )
    thread.start()
    try:
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.sendall(
                f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode()
            )
            response = client.recv(4096)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    return response, marker


@pytest.mark.parametrize(
    ("target", "resolved"),
    [
        ("127.0.0.1:445", "127.0.0.1"),
        ("[::ffff:127.0.0.1]:443", "::ffff:127.0.0.1"),
        ("192.168.1.1:80", "192.168.1.1"),
        ("rebinding.example:443", "127.0.0.1"),
        ("example.com:22", "192.0.2.10"),
    ],
)
def test_denied_connect_requests_return_403_without_starting_the_connector(
    tmp_path, target, resolved
):
    response, marker = proxy_request(tmp_path, target, answers(resolved))
    assert response.startswith(b"HTTP/1.1 403 Forbidden\r\n")
    assert not marker.exists()


def test_example_https_connect_passes_the_verified_ip_to_the_connector(tmp_path):
    response, marker = proxy_request(tmp_path, "example.com:443", answers("192.0.2.10"))
    assert response.startswith(b"HTTP/1.1 200 Connection Established\r\n")
    assert marker.read_text(encoding="utf-8") == "192.0.2.10 443"
