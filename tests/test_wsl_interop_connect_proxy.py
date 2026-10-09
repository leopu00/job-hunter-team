"""The Windows interop proxy is public-network-only, including after DNS."""

from __future__ import annotations

import importlib.util
import os
import socket
import threading
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PROXY_PATH = ROOT / "scripts" / "wsl-interop-connect-proxy.py"
SPEC = importlib.util.spec_from_file_location("jht_wsl_interop_proxy", PROXY_PATH)
assert SPEC and SPEC.loader
PROXY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROXY)


def answers(*addresses: str):
    def resolve(_host, port, *, family, type, proto):
        assert family == socket.AF_INET
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


@pytest.mark.parametrize(
    ("policy", "allowed", "denied"),
    [
        ("agent", (80, 443), (465, 587, 993)),
        ("broker", (443, 465, 587, 993), (80, 22)),
        ("telegram", (443,), (80, 465, 587, 993)),
    ],
)
def test_named_policy_has_only_its_service_ports(policy, allowed, denied):
    host = "api.telegram.org" if policy == "telegram" else "public.example"
    for port in allowed:
        assert (
            PROXY.resolve_public_target(
                host,
                port,
                answers("192.0.2.10"),
                PROXY.POLICY_PORTS[policy],
                PROXY.POLICY_HOSTS[policy],
            )
            == "192.0.2.10"
        )
    for port in denied:
        with pytest.raises(PROXY.PolicyDenied):
            PROXY.resolve_public_target(
                host,
                port,
                answers("192.0.2.10"),
                PROXY.POLICY_PORTS[policy],
                PROXY.POLICY_HOSTS[policy],
            )


@pytest.mark.parametrize(
    ("policy", "port"),
    [("agent", 443), ("broker", 993), ("telegram", 443)],
)
def test_every_service_policy_shares_the_public_address_filter(policy, port):
    host = "api.telegram.org" if policy == "telegram" else "destination.example"
    for address in ("127.0.0.1", "192.168.1.1", "::1", "fc00::1"):
        with pytest.raises(PROXY.PolicyDenied):
            PROXY.resolve_public_target(
                host,
                port,
                answers(address),
                PROXY.POLICY_PORTS[policy],
                PROXY.POLICY_HOSTS[policy],
            )


@pytest.mark.parametrize(
    "host", ["example.com", "telegram.org", "sub.api.telegram.org", "192.0.2.10"]
)
def test_telegram_policy_denies_every_destination_except_the_api_name(host):
    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target(
            host,
            443,
            answers("192.0.2.10"),
            PROXY.POLICY_PORTS["telegram"],
            PROXY.POLICY_HOSTS["telegram"],
        )


@pytest.mark.parametrize("host", ["api.telegram.org", "API.TELEGRAM.ORG."])
def test_telegram_policy_accepts_only_the_normalized_api_name(host):
    assert (
        PROXY.resolve_public_target(
            host,
            443,
            answers("192.0.2.10"),
            PROXY.POLICY_PORTS["telegram"],
            PROXY.POLICY_HOSTS["telegram"],
        )
        == "192.0.2.10"
    )


def test_standalone_proxy_defaults_to_the_agent_policy():
    args = PROXY.parse_args(["--connector", "/unused"])

    assert args.policy == "agent"
    assert PROXY.POLICY_PORTS[args.policy] == frozenset({80, 443})


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


def echo_connector(tmp_path: Path) -> Path:
    script = tmp_path / "echo-connector"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "sys.stdout.buffer.write(b'\\x00'); sys.stdout.buffer.flush()\n"
        "while True:\n"
        "    data = sys.stdin.buffer.read(1)\n"
        "    if not data: break\n"
        "    sys.stdout.buffer.write(data); sys.stdout.buffer.flush()\n",
        encoding="utf-8",
    )
    script.chmod(0o700)
    return script


def never_ready_connector(tmp_path: Path) -> Path:
    script = tmp_path / "never-ready-connector"
    script.write_text(
        "#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n", encoding="utf-8"
    )
    script.chmod(0o700)
    return script


def proxy_request(
    tmp_path: Path,
    target: str,
    resolver,
    allowed_ports=PROXY.POLICY_PORTS["agent"],
    allowed_hosts=PROXY.POLICY_HOSTS["agent"],
) -> tuple[bytes, Path]:
    executable, marker = connector(tmp_path)
    server = PROXY.ThreadingProxy(
        ("127.0.0.1", 0),
        str(executable),
        resolver,
        allowed_ports,
        allowed_hosts,
    )
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


def test_a_client_that_never_sends_the_handshake_is_closed_quickly(tmp_path):
    executable, _marker = connector(tmp_path)
    server = PROXY.ThreadingProxy(
        ("127.0.0.1", 0),
        str(executable),
        answers("192.0.2.10"),
        handshake_timeout=0.05,
    )
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}
    )
    thread.start()
    try:
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.settimeout(2)
            response = client.recv(4096)
            assert response.startswith(b"HTTP/1.1 502 Bad Gateway\r\n")
            assert client.recv(1) == b""
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_a_connector_that_never_completes_the_handshake_is_closed_quickly(tmp_path):
    server = PROXY.ThreadingProxy(
        ("127.0.0.1", 0),
        str(never_ready_connector(tmp_path)),
        answers("192.0.2.10"),
        handshake_timeout=0.05,
    )
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}
    )
    thread.start()
    try:
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.settimeout(2)
            client.sendall(
                b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"
            )
            response = client.recv(4096)
            assert response.startswith(b"HTTP/1.1 502 Bad Gateway\r\n")
            assert client.recv(1) == b""
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_connect_tunnels_have_a_ten_minute_idle_budget():
    assert PROXY.HANDSHAKE_TIMEOUT_SECONDS == 65
    assert PROXY.CONNECT_IDLE_TIMEOUT_SECONDS == 600


@pytest.mark.skipif(
    os.environ.get("JHT_PROXY_IDLE_LIVE") != "1",
    reason="set JHT_PROXY_IDLE_LIVE=1 for the real 120-second silence probe",
)
def test_live_connect_tunnel_survives_120_seconds_of_silence(tmp_path):
    server = PROXY.ThreadingProxy(
        ("127.0.0.1", 0),
        str(echo_connector(tmp_path)),
        answers("192.0.2.10"),
    )
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}
    )
    thread.start()
    try:
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.settimeout(5)
            client.sendall(
                b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"
            )
            response = client.recv(4096)
            assert response.startswith(b"HTTP/1.1 200 Connection Established\r\n")
            time.sleep(120)
            client.sendall(b"x")
            assert client.recv(1) == b"x"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


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


def test_telegram_proxy_denies_another_public_https_name_before_connecting(tmp_path):
    response, marker = proxy_request(
        tmp_path,
        "example.com:443",
        answers("192.0.2.10"),
        PROXY.POLICY_PORTS["telegram"],
        PROXY.POLICY_HOSTS["telegram"],
    )

    assert response.startswith(b"HTTP/1.1 403 Forbidden\r\n")
    assert not marker.exists()


def test_telegram_proxy_connects_to_the_verified_api_ip(tmp_path):
    response, marker = proxy_request(
        tmp_path,
        "api.telegram.org:443",
        answers("192.0.2.10"),
        PROXY.POLICY_PORTS["telegram"],
        PROXY.POLICY_HOSTS["telegram"],
    )

    assert response.startswith(b"HTTP/1.1 200 Connection Established\r\n")
    assert marker.read_text(encoding="utf-8") == "192.0.2.10 443"


# A global IPv6 address can still be the user's home: SLAAC gives the LAN's
# devices and the PC addresses on the home /64, and no fixed range tells them
# apart from the Internet. The containers are IPv4-only (pasta -4), so the
# proxy asks DNS for IPv4 only and refuses any IPv6 destination.
@pytest.mark.parametrize("answer", [("2001:db8:1:2::10",), ("192.0.2.10", "2001:db8:1:2::10")])
def test_a_global_ipv6_answer_is_refused(answer):
    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target("nas.example", 443, answers(*answer))


@pytest.mark.parametrize("host", ["2001:db8:1:2::10", "[2001:db8:1:2::10]"])
def test_an_ipv6_literal_is_refused_without_dns(host):
    def must_not_resolve(*_args, **_kwargs):
        raise AssertionError("an IPv6 literal reached DNS")

    with pytest.raises(PROXY.PolicyDenied):
        PROXY.resolve_public_target(host, 443, must_not_resolve)


def test_dns_is_asked_for_ipv4_only():
    asked = []

    def resolve(host, port, **kwargs):
        asked.append(kwargs.get("family"))
        return answers("192.0.2.10")(host, port, **kwargs)

    assert PROXY.resolve_public_target("example.com", 443, resolve) == "192.0.2.10"
    assert asked == [socket.AF_INET]
