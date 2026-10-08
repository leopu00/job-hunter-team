"""R4, live: the login view's port reaches the host's loopback and nothing else.

A stand-in broker (a listener on 6081, published on 127.0.0.1 only, on its
own network) and a stand-in agent (on another network, as in the compose).
From the agent, every way to the port must fail:
- the broker's own IP (same as a shared compose network would allow);
- the agent network's gateway;
- host.docker.internal / host.containers.internal mapped to the host gateway.

From the host, 127.0.0.1:<published> answers: the listener is really up,
so a refusal above is the network, not a dead listener.

With Docker and, when present, rootless Podman. Needs Linux; runs in CI.

Run with: pytest tests/test_broker_view_network_live.py -v
"""

import json
import shutil
import socket
import subprocess
import time
import uuid

import pytest

IMAGE = "docker.io/library/python:3.11-slim-bookworm"


def _engine_ok(engine: str) -> bool:
    if shutil.which(engine) is None:
        return False
    try:
        return subprocess.run([engine, "info"], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


ENGINES = [e for e in ("docker", "podman") if _engine_ok(e)]
pytestmark = pytest.mark.skipif(not ENGINES, reason="needs Linux with Docker or Podman (runs in CI)")


def run(engine, *args, check=True, timeout=300):
    result = subprocess.run([engine, *args], capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        raise AssertionError(f"{engine} {' '.join(args)} -> {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


LISTENER = (
    "import socket\n"
    "s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n"
    "s.bind(('0.0.0.0', 6081)); s.listen(8)\n"
    "while True:\n"
    "    c, _ = s.accept(); c.sendall(b'VIEW\\n'); c.close()\n"
)

PROBE = (
    "import json, socket, sys\n"
    "out = {}\n"
    "for name, host in json.loads(sys.argv[1]).items():\n"
    "    try:\n"
    "        with socket.create_connection((host, 6081), timeout=3) as c:\n"
    "            out[name] = c.recv(16).decode(errors='replace') or 'OPEN'\n"
    "    except OSError as e:\n"
    "        out[name] = 'refused:' + type(e).__name__\n"
    "print(json.dumps(out))\n"
)


@pytest.mark.parametrize("engine", ENGINES)
def test_the_view_port_is_reachable_only_from_the_hosts_loopback(engine):
    tag = uuid.uuid4().hex[:8]
    broker_net, agent_net, broker = f"jhtv-b-{tag}", f"jhtv-a-{tag}", f"jhtv-broker-{tag}"
    port = free_port()
    gateway_name = "host.containers.internal" if engine == "podman" else "host.docker.internal"
    run(engine, "pull", IMAGE, timeout=600)
    run(engine, "network", "create", broker_net)
    run(engine, "network", "create", agent_net)
    try:
        run(engine, "run", "-d", "--name", broker, "--network", broker_net, "-p", f"127.0.0.1:{port}:6081",
            IMAGE, "python3", "-c", LISTENER)
        for _ in range(60):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1) as c:
                    if c.recv(16).startswith(b"VIEW"):
                        break
            except OSError:
                pass
            time.sleep(0.5)
        else:
            raise AssertionError("the listener never answered on the host's loopback")

        fmt = "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"
        broker_ip = run(engine, "inspect", broker, "--format", fmt).stdout.split()[0]
        gw_fmt = "{{range .IPAM.Config}}{{.Gateway}} {{end}}" if engine == "docker" else "{{range .Subnets}}{{.Gateway}} {{end}}"
        gateway = run(engine, "network", "inspect", agent_net, "--format", gw_fmt).stdout.split()[0]
        targets = {"broker_ip": broker_ip, "gateway": gateway, gateway_name: gateway_name}
        probe = run(engine, "run", "--rm", "--network", agent_net, "--add-host", f"{gateway_name}:host-gateway",
                    IMAGE, "python3", "-c", PROBE, json.dumps(targets), check=False)
        answers = json.loads(probe.stdout.strip().splitlines()[-1])
        assert all(v.startswith("refused:") for v in answers.values()), answers
    finally:
        run(engine, "rm", "-f", broker, check=False)
        run(engine, "network", "rm", broker_net, agent_net, check=False)
