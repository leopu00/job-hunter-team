"""On Podman (Windows, WSL) each container leaves only through its own proxy.

With `network_mode: host` the container shared the VM's network: the proxy
was only an environment variable, and an agent could skip it (`curl
--noproxy '*'`) to reach the LAN, the Windows host and the VM's loopback (the
proxy itself, the broker's login view on 6081). docker-compose.podman.yml now
runs the container on pasta with no route out and one forwarded port, the
VM's 127.0.0.1:3128 where the egress proxy listens. The broker (3129) and the
Telegram service (3130) left directly from the compose bridge, LAN included:
they run the same way, each with its own proxy instance and policy
(configure-podman-windows-network.ps1).

- The static tests pin that line, the wrapper's trust check on it, and that
  the override never reaches Linux or a VPS (it is a Windows-only file).
- The live test runs on a real Podman machine, from a container on that
  network, and tries every way out. Opt-in:

      JHT_PODMAN_EGRESS_CONNECTION=<podman connection> pytest tests/test_podman_network_egress.py

  On Windows: the JHT machine's connection (podman system connection list).
  Optional: JHT_PODMAN_EGRESS_IMAGE (a local image with python3, default
  python:3.11-slim-bookworm), JHT_PODMAN_EGRESS_LAN=<ip> (a LAN address, e.g.
  the router), JHT_PODMAN_EGRESS_COMPOSE (another override, to see the
  starting red with the old `network_mode: host`).
"""

import json
import os
import re
import shutil
import socket
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
OVERRIDE = ROOT / "docker-compose.podman.yml"
# Each service, its proxy port, the proxy policy listening there, and a real
# destination that policy admits (the live test's positive check).
SERVICES = {
    "jht": (3128, "agent", ("example.com", 443)),
    "jht-broker": (3129, "broker", ("imap.gmail.com", 993)),
    "jht-telegram": (3130, "telegram", ("api.telegram.org", 443)),
}
PROXY_PORT = 3128


def _pasta(port: int) -> str:
    return f"pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,{port}"


class _ComposeLoader(yaml.SafeLoader):
    pass


for _tag in ("!reset", "!override"):
    _ComposeLoader.add_constructor(_tag, lambda loader, node: None)


def _services(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_ComposeLoader)["services"]


def _pasta_options(network_mode: str) -> list[str]:
    assert network_mode.startswith("pasta:"), network_mode
    return network_mode.removeprefix("pasta:").split(",")


@pytest.mark.parametrize("service", SERVICES)
def test_each_service_runs_on_pasta_with_its_proxy_as_the_only_way_out(service):
    port = SERVICES[service][0]
    network = _services(OVERRIDE)[service]["network_mode"]
    assert network == _pasta(port)
    options = _pasta_options(network)
    # What each option buys (see the override's comment).
    for flag in ("--no-udp", "--no-icmp", "--no-map-gw", "-4"):
        assert flag in options, flag
    assert options[options.index("-o") + 1] == "127.0.0.1"
    # One forwarded port out of the namespace, the proxy's; nothing that
    # widens it (port ranges, `all`, a second -T, a mapped host loopback).
    forwards = [options[i + 1] for i, flag in enumerate(options) if flag in ("-T", "--tcp-ns")]
    assert forwards == [str(port)]
    for widening in ("-U", "--udp-ns", "--map-host-loopback", "--freebind", "--outbound-if4"):
        assert widening not in options, widening


@pytest.mark.parametrize("service", ["jht-broker", "jht-telegram"])
def test_the_broker_and_telegram_are_given_their_own_proxy(service):
    environment = _services(OVERRIDE)[service]["environment"]
    url = f"http://127.0.0.1:{SERVICES[service][0]}"
    assert f"HTTPS_PROXY={url}" in environment and f"https_proxy={url}" in environment


def test_node_in_the_container_goes_through_the_proxy():
    # Without it Node's fetch ignores HTTP(S)_PROXY and, with no direct route
    # left, times out instead of reaching the proxy (measured).
    assert "NODE_USE_ENV_PROXY=1" in _services(OVERRIDE)["jht"]["environment"]


def test_no_compose_service_shares_the_host_network():
    for path in sorted(ROOT.glob("docker-compose*.yml")):
        for name, service in _services(path).items():
            assert service.get("network_mode") != "host", f"{path.name}: {name}"


def test_the_wrapper_trusts_the_override_only_with_those_lines():
    wrapper = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    for port, _, _ in SERVICES.values():
        assert f"-SimpleMatch 'network_mode: \"{_pasta(port)}\"'" in wrapper, port
    assert "'network_mode: host'" not in wrapper


def test_each_forwarded_port_is_the_one_its_proxy_instance_listens_on():
    configure = (ROOT / "scripts" / "configure-podman-windows-network.ps1").read_text(encoding="utf-8")
    variables = {"agent": "Port", "broker": "BrokerPort", "telegram": "TelegramPort"}
    for port, policy, _ in SERVICES.values():
        variable = variables[policy]
        assert re.search(rf"\[int\]\${variable} = {port}\b", configure), variable
        assert f"-Policy {policy} -ListenPort ${variable}" in configure, policy
    assert "--bind 127.0.0.1 --port $ListenPort --policy $Policy" in configure
    wrapper = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    assert f"'http://127.0.0.1:{PROXY_PORT}'" in wrapper


def test_the_podman_override_never_reaches_linux_or_a_vps():
    # The VPS and Linux paths install and run with the sh installer, wrapper
    # and host-setup: none of them may know the override, so a "Podman
    # everywhere" change cannot carry the agents' network mode there unseen.
    for relative in (
        "scripts/install.sh",
        "web/public/install.sh",
        "scripts/jht-wrapper.sh",
        "scripts/host-setup.sh",
    ):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "docker-compose.podman.yml" not in source, relative
    # Only the Windows runtime publishes it.
    publishers = sorted(
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "scripts").iterdir()
        if path.is_file() and "docker-compose.podman.yml" in path.read_text(encoding="utf-8", errors="ignore")
    )
    assert publishers and all(path.endswith(".ps1") for path in publishers), publishers


# ── Live: from a container on that network, every way out ─────────────────

CONNECTION = os.environ.get("JHT_PODMAN_EGRESS_CONNECTION", "")
IMAGE = os.environ.get("JHT_PODMAN_EGRESS_IMAGE", "docker.io/library/python:3.11-slim-bookworm")
VM_SERVICE_PORT = 46081  # a stand-in for the VM's loopback services (the broker view)
VM_WIDE_SERVICE_PORT = 46082  # a stand-in for a VM service on 0.0.0.0 (sshd and the like)

# The VM's own non-loopback IPv4 addresses, read from a container on the host
# network: a service the VM runs on 0.0.0.0 answers on each of them.
VM_ADDRESSES = r"""
import json
addresses, last = set(), None
for line in open("/proc/net/fib_trie"):
    parts = line.split()
    if len(parts) >= 2 and parts[0] in ("|--", "+--"):
        last = parts[1].split("/")[0]
    elif "/32 host LOCAL" in line and last and not last.startswith("127."):
        addresses.add(last)
print(json.dumps(sorted(addresses)))
"""

LISTENER = r"""
import socket, threading, time
def pipe(a, b):
    try:
        while (data := a.recv(65536)):
            b.sendall(data)
    except OSError:
        pass
    finally:
        for end in (a, b):
            try:
                end.close()
            except OSError:
                pass
def tunnel(client):
    # A stand-in CONNECT proxy, used only where nothing holds the proxy port
    # (on Windows the real filtering proxy does).
    request = b""
    while b"\r\n\r\n" not in request:
        request += client.recv(4096)
    host, port = request.split()[1].decode().rsplit(":", 1)
    upstream = socket.create_connection((host, int(port)), timeout=10)
    client.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    pipe(upstream, client)
def serve(port, handle):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        return  # already taken: on Windows the real proxy holds it
    s.listen()
    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()
for proxy_port in %r:
    threading.Thread(target=serve, args=(proxy_port, tunnel), daemon=True).start()
threading.Thread(target=serve, args=(%d, lambda c: c.close()), daemon=True).start()
def serve_everywhere(port):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port)); s.listen()
    while True:
        c, _ = s.accept(); c.close()
threading.Thread(target=serve_everywhere, args=(%d,), daemon=True).start()
time.sleep(300)
""" % (tuple(port for port, _, _ in SERVICES.values()), VM_SERVICE_PORT, VM_WIDE_SERVICE_PORT)

PROBE = r"""
import json, socket, ssl, struct, sys
targets = json.loads(sys.argv[1])
proxy_port, allowed_host, allowed_port = targets["proxy_port"], targets["allowed_host"], targets["allowed_port"]
gateway = None
for line in open("/proc/net/route").read().splitlines()[1:]:
    fields = line.split()
    if fields[1] == "00000000":
        gateway = socket.inet_ntoa(struct.pack("<L", int(fields[2], 16)))
def tcp(host, port, family=socket.AF_INET):
    s = socket.socket(family); s.settimeout(6)
    try:
        s.connect((host, port)); return True
    except OSError:
        return False
    finally:
        s.close()
def udp_dns():
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(4)
    query = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01"
    try:
        u.sendto(query, (targets["dns"], 53)); u.recv(512); return True
    except OSError:
        return False
def through_the_proxy():
    # The positive check: a real CONNECT through this service's proxy to a
    # destination its policy admits, then a TLS handshake whose certificate
    # is verified for that name. A proxy that answers but does not forward,
    # or forwards somewhere else, fails here.
    try:
        sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=20)
        target = f"{allowed_host}:{allowed_port}"
        sock.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
        reply = b""
        while b"\r\n\r\n" not in reply:
            chunk = sock.recv(1)
            if not chunk:
                return "proxy closed"
            reply += chunk
        status = reply.split(b"\r\n", 1)[0].split()[1].decode()
        if status != "200":
            return f"proxy answered {status}"
        with ssl.create_default_context().wrap_socket(sock, server_hostname=allowed_host):
            return "forwarded"
    except Exception as error:
        return type(error).__name__
reach = {
    "VM loopback service": tcp("127.0.0.1", %d),
    "VM service on 0.0.0.0, through the VM's own addresses": any(tcp(a, %d) for a in targets["vm_addresses"]),
    "another service's proxy": any(tcp("127.0.0.1", port) for port in %r if port != proxy_port),
    "Internet, direct": tcp(targets["internet4"], 443),
    "DNS over UDP": udp_dns(),
}
if targets["internet6"]:
    reach["IPv6, direct"] = tcp(targets["internet6"], 443, socket.AF_INET6)
if gateway:
    reach["gateway on 445 (the Windows host on WSL NAT)"] = tcp(gateway, 445)
    reach["gateway on 80"] = tcp(gateway, 80)
if targets["lan"]:
    reach["LAN address on 80"] = tcp(targets["lan"], 80)
print(json.dumps({"proxy": through_the_proxy(), "reach": reach}))
""" % (VM_SERVICE_PORT, VM_WIDE_SERVICE_PORT, tuple(port for port, _, _ in SERVICES.values()))


def _public_targets() -> dict[str, str]:
    """Public addresses resolved here, outside the container (which has no
    DNS): a web server, a DNS server and, when there is one, an IPv6 web
    server. No address is written in the repo."""
    def first(name: str, port: int, family: int) -> str:
        try:
            return socket.getaddrinfo(name, port, family, socket.SOCK_STREAM)[0][4][0]
        except OSError:
            return ""
    targets = {
        "internet4": first("example.com", 443, socket.AF_INET),
        "internet6": first("example.com", 443, socket.AF_INET6),
        "dns": first("one.one.one.one", 53, socket.AF_INET),
        "lan": os.environ.get("JHT_PODMAN_EGRESS_LAN", ""),
    }
    assert targets["internet4"] and targets["dns"], "the test machine must resolve example.com and one.one.one.one"
    return targets


def _podman(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["podman", "--connection", CONNECTION, *args],
        capture_output=True, text=True, timeout=120, check=check,
    )


@pytest.mark.skipif(not CONNECTION, reason="live: set JHT_PODMAN_EGRESS_CONNECTION")
@pytest.mark.skipif(shutil.which("podman") is None, reason="podman not installed")
@pytest.mark.parametrize("service", SERVICES)
def test_from_each_container_only_its_proxy_answers_and_forwards(service):
    override = Path(os.environ.get("JHT_PODMAN_EGRESS_COMPOSE", OVERRIDE))
    network = _services(override)[service].get("network_mode", "the compose bridge")
    proxy_port, _, (allowed_host, allowed_port) = SERVICES[service]
    targets = {
        **_public_targets(),
        "proxy_port": proxy_port,
        "allowed_host": allowed_host,
        "allowed_port": allowed_port,
    }
    targets["vm_addresses"] = json.loads(
        _podman("run", "--rm", "--network", "host", "--entrypoint", "python3", IMAGE, "-c", VM_ADDRESSES)
        .stdout.strip().splitlines()[-1]
    )
    listener = f"jht-egress-listener-{os.getpid()}"
    _podman(
        "run", "-d", "--rm", "--name", listener, "--network", "host",
        "--entrypoint", "python3", IMAGE, "-c", LISTENER,
    )
    try:
        # Each answer is measured three times: a single run of a network
        # probe can time out by chance.
        runs = []
        for _ in range(3):
            network_args = ["--network", network] if network.startswith("pasta:") else []
            result = _podman(
                "run", "--rm", *network_args, "--entrypoint", "python3", IMAGE,
                "-c", PROBE, json.dumps(targets),
            )
            runs.append(json.loads(result.stdout.strip().splitlines()[-1]))
    finally:
        _podman("rm", "-f", "-v", listener, check=False)

    for run in runs:
        assert run["proxy"] == "forwarded", f"{service}: {allowed_host} through its proxy: {run['proxy']}"
        open_ways = [way for way, reached in run["reach"].items() if reached]
        assert not open_ways, f"{service} on {network}: reachable besides its proxy: {open_ways}"
