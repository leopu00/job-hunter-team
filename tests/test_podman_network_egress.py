"""The agents' container on Podman (Windows, WSL) leaves only through the proxy.

With `network_mode: host` the container shared the VM's network: the proxy
was only an environment variable, and an agent could skip it (`curl
--noproxy '*'`) to reach the LAN, the Windows host and the VM's loopback (the
proxy itself, the broker's login view on 6081). docker-compose.podman.yml now
runs the container on pasta with no route out and one forwarded port, the
VM's 127.0.0.1:3128 where the egress proxy listens.

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
PASTA = "pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,3128"
PROXY_PORT = 3128


class _ComposeLoader(yaml.SafeLoader):
    pass


for _tag in ("!reset", "!override"):
    _ComposeLoader.add_constructor(_tag, lambda loader, node: None)


def _services(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_ComposeLoader)["services"]


def _pasta_options(network_mode: str) -> list[str]:
    assert network_mode.startswith("pasta:"), network_mode
    return network_mode.removeprefix("pasta:").split(",")


def test_the_agents_run_on_pasta_with_the_proxy_as_the_only_way_out():
    network = _services(OVERRIDE)["jht"]["network_mode"]
    assert network == PASTA
    options = _pasta_options(network)
    # What each option buys (see the override's comment).
    for flag in ("--no-udp", "--no-icmp", "--no-map-gw", "-4"):
        assert flag in options, flag
    assert options[options.index("-o") + 1] == "127.0.0.1"
    # One forwarded port out of the namespace, the proxy's; nothing that
    # widens it (port ranges, `all`, a second -T, a mapped host loopback).
    forwards = [options[i + 1] for i, flag in enumerate(options) if flag in ("-T", "--tcp-ns")]
    assert forwards == [str(PROXY_PORT)]
    for widening in ("-U", "--udp-ns", "--map-host-loopback", "--freebind", "--outbound-if4"):
        assert widening not in options, widening


def test_node_in_the_container_goes_through_the_proxy():
    # Without it Node's fetch ignores HTTP(S)_PROXY and, with no direct route
    # left, times out instead of reaching the proxy (measured).
    assert "NODE_USE_ENV_PROXY=1" in _services(OVERRIDE)["jht"]["environment"]


def test_no_compose_service_shares_the_host_network():
    for path in sorted(ROOT.glob("docker-compose*.yml")):
        for name, service in _services(path).items():
            assert service.get("network_mode") != "host", f"{path.name}: {name}"


def test_the_wrapper_trusts_the_override_only_with_that_line():
    wrapper = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    assert f"-SimpleMatch 'network_mode: \"{PASTA}\"'" in wrapper
    assert "'network_mode: host'" not in wrapper


def test_the_forwarded_port_is_the_one_the_proxy_listens_on():
    configure = (ROOT / "scripts" / "configure-podman-windows-network.ps1").read_text(encoding="utf-8")
    assert re.search(rf"\[int\]\$Port = {PROXY_PORT}\b", configure)
    assert "--bind 127.0.0.1 --port $Port" in configure
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

LISTENER = r"""
import socket, threading, time
def serve(port):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        return  # already taken: on Windows the real proxy holds 3128
    s.listen()
    while True:
        c, _ = s.accept(); c.close()
for port in (%d, %d):
    threading.Thread(target=serve, args=(port,), daemon=True).start()
time.sleep(300)
""" % (PROXY_PORT, VM_SERVICE_PORT)

PROBE = r"""
import json, socket, struct, sys
targets = json.loads(sys.argv[1])
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
reach = {
    "proxy 127.0.0.1:%d": tcp("127.0.0.1", %d),
    "VM loopback service 127.0.0.1:%d": tcp("127.0.0.1", %d),
    f"Internet {targets['internet4']}:443": tcp(targets["internet4"], 443),
    f"DNS over UDP {targets['dns']}:53": udp_dns(),
}
if targets["internet6"]:
    reach[f"IPv6 [{targets['internet6']}]:443"] = tcp(targets["internet6"], 443, socket.AF_INET6)
if gateway:
    reach[f"gateway (Windows host on WSL NAT) {gateway}:445"] = tcp(gateway, 445)
    reach[f"gateway {gateway}:80"] = tcp(gateway, 80)
if targets["lan"]:
    reach[f"LAN {targets['lan']}:80"] = tcp(targets["lan"], 80)
print(json.dumps(reach))
""" % (PROXY_PORT, PROXY_PORT, VM_SERVICE_PORT, VM_SERVICE_PORT)


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
def test_from_the_container_only_the_proxy_answers():
    override = Path(os.environ.get("JHT_PODMAN_EGRESS_COMPOSE", OVERRIDE))
    network = _services(override)["jht"]["network_mode"]
    targets = _public_targets()
    listener = f"jht-egress-listener-{os.getpid()}"
    _podman("run", "-d", "--rm", "--name", listener, "--network", "host", IMAGE, "python3", "-c", LISTENER)
    try:
        # Each answer is measured three times: a single run of a network
        # probe can time out by chance.
        runs = []
        for _ in range(3):
            result = _podman(
                "run", "--rm", "--network", network, IMAGE,
                "python3", "-c", PROBE, json.dumps(targets),
            )
            runs.append(json.loads(result.stdout.strip().splitlines()[-1]))
    finally:
        _podman("rm", "-f", listener, check=False)

    for reach in runs:
        proxy = f"proxy 127.0.0.1:{PROXY_PORT}"
        assert reach.pop(proxy), f"{network}: the proxy is not reachable"
        assert not any(reach.values()), f"{network}: reachable besides the proxy: {[k for k, v in reach.items() if v]}"
