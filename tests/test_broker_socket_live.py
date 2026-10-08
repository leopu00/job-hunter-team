"""The broker's socket, live: who may talk, and what the agents cannot touch.

Two containers as in the compose: a broker (uid 1002) serving the real
`shared/broker` code, and an agent (uid 1001) with the socket volume mounted
read-only. Checked from the agent's side:

- a request as uid 1001 gets an answer; any other uid gets `peer_not_allowed`;
- the socket volume is read-only: no new file, no symlink, no unlink;
- the broker's secrets and state are not in the agent's filesystem at all.

With Docker and, when present, rootless Podman with `keep-id` on both
containers: that is the mapping under which the broker must still see the
agents as uid 1001 (design §9). Needs Linux with the engine; runs in CI.

Run with: pytest tests/test_broker_socket_live.py -v
"""

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
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


def run(engine, *args, check=True, timeout=300, input=None):
    result = subprocess.run([engine, *args], capture_output=True, text=True, timeout=timeout, input=input)
    if check and result.returncode != 0:
        raise AssertionError(f"{engine} {' '.join(args)} -> {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result


@pytest.fixture(params=ENGINES)
def stack(request):
    engine = request.param
    tag = uuid.uuid4().hex[:8]
    names = {k: f"jhtbt-{k}-{tag}" for k in ("secrets", "state", "sock")}
    broker = f"jhtbt-broker-{tag}"
    userns = ["--userns", "keep-id:uid=1001,gid=1001"] if engine == "podman" else []
    run(engine, "pull", IMAGE, timeout=600)
    for vol in names.values():
        run(engine, "volume", "create", vol)
    # What the image does at build time: the three mount points belong to the
    # broker, the socket directory is traversable but not listable.
    run(engine, "run", "--rm", *userns, "--user", "0:0",
        "-v", f"{names['secrets']}:/s", "-v", f"{names['state']}:/t", "-v", f"{names['sock']}:/k",
        IMAGE, "sh", "-c", "chown 1002:1002 /s /t /k && chmod 0700 /s /t && chmod 0711 /k")
    run(engine, "run", "-d", "--name", broker, *userns, "--user", "1002:1002",
        "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--network", "none",
        "-e", "PYTHONPATH=/srv/shared", "-e", "PYTHONDONTWRITEBYTECODE=1",
        "-e", "JHT_BROKER_SECRETS=/jht_secrets", "-e", "JHT_BROKER_STATE=/jht_broker_state",
        "-v", f"{ROOT / 'shared'}:/srv/shared:ro",
        "-v", f"{names['secrets']}:/jht_secrets", "-v", f"{names['state']}:/jht_broker_state",
        "-v", f"{names['sock']}:/run/jht-broker",
        IMAGE, "python3", "-c", "from broker.server import serve; serve()")
    for _ in range(60):
        logs = run(engine, "logs", broker, check=False)
        if "listening" in logs.stdout + logs.stderr:
            break
        time.sleep(0.5)
    else:
        raise AssertionError("broker did not start:\n" + run(engine, "logs", broker, check=False).stderr)

    def agent(script: str, uid: str = "1001"):
        return run(engine, "run", "--rm", *userns, "--user", f"{uid}:{uid}", "--network", "none",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                   "-e", "PYTHONPATH=/srv/shared", "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "JHT_AGENT_NAME=scout",
                   "-v", f"{ROOT / 'shared'}:/srv/shared:ro",
                   "-v", f"{names['sock']}:/run/jht-broker:ro",
                   IMAGE, "python3", "-c", script, check=False)

    yield engine, agent, broker
    run(engine, "rm", "-f", broker, check=False)
    for vol in names.values():
        run(engine, "volume", "rm", "-f", vol, check=False)


CALL = "from broker.client import call; import json; print(json.dumps(call('mail.status')))"


def test_the_agents_uid_gets_an_answer(stack):
    engine, agent, _ = stack
    result = agent(CALL)
    answer = json.loads(result.stdout.strip().splitlines()[-1])
    # No mailbox saved in this throwaway stack: a broker answer, not a refusal.
    assert answer == {"ok": True, "configured": False, "address": "", "admission": "allowlist",
                      "rotation_pending": False, "seen_count": 0}, result.stderr


def test_any_other_uid_is_refused_before_the_request_is_read(stack):
    engine, agent, _ = stack
    result = agent(CALL, uid="1003")
    answer = json.loads(result.stdout.strip().splitlines()[-1])
    assert answer == {"ok": False, "reason": "peer_not_allowed"}, result.stderr


def test_the_agent_cannot_replace_the_socket_or_plant_a_file(stack):
    engine, agent, _ = stack
    script = (
        "import os, errno\n"
        "out = []\n"
        "for name, fn in [('create', lambda: open('/run/jht-broker/x', 'w')),"
        " ('symlink', lambda: os.symlink('/tmp/evil', '/run/jht-broker/broker2.sock')),"
        " ('unlink', lambda: os.unlink('/run/jht-broker/broker.sock')),"
        " ('rename', lambda: os.rename('/run/jht-broker/broker.sock', '/run/jht-broker/y'))]:\n"
        "    try:\n"
        "        fn(); out.append(name + ':DONE')\n"
        "    except OSError as e:\n"
        "        out.append(name + ':' + errno.errorcode.get(e.errno, str(e.errno)))\n"
        "print(' '.join(out))\n"
    )
    result = agent(script)
    line = result.stdout.strip()
    assert "DONE" not in line, line
    assert line.count("EROFS") + line.count("EACCES") == 4, line


def test_the_brokers_volumes_are_not_in_the_agents_filesystem(stack):
    engine, agent, _ = stack
    result = agent("import os; print(os.path.exists('/jht_secrets'), os.path.exists('/jht_broker_state'))")
    assert result.stdout.strip() == "False False"


def test_unknown_operations_are_refused_over_the_real_socket(stack):
    engine, agent, _ = stack
    script = ("from broker.client import call; import json; "
              "print(json.dumps([call(op).get('reason') for op in ('secrets.status', 'mail.code', 'mail.approve')]))")
    result = agent(script)
    assert json.loads(result.stdout.strip()) == ["unknown_operation"] * 3
