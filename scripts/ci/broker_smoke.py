#!/usr/bin/env python3
"""The portal-secrets broker, on the real image (P1 portal secrets, phase 1a).

Starts IMAGE as the compose starts `jht-broker` (uid 1002, read-only root,
no capabilities, no new privileges, the three named volumes) and, as the
agents (uid 1001, socket volume read-only), asks it `mail.status`:

  - uid 1001 gets a broker answer (`configured: false` on fresh volumes);
  - uid 1003 gets `peer_not_allowed`;
  - from uid 1001 the socket volume refuses a new file;
  - the broker's secret and state volumes are not in the agent's filesystem;
  - the login view's websockify logs a connection without its token.

Usage: broker_smoke.py IMAGE
Exit 0 when every check passes; 1 with one FAIL line per broken check.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import uuid

HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"]


def docker(*args: str, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        raise SystemExit(f"docker {' '.join(args)} -> {result.returncode}\n{result.stderr}")
    return result


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    image = argv[0]
    tag = uuid.uuid4().hex[:8]
    vols = {"secrets": f"jhtbs-sec-{tag}", "state": f"jhtbs-st-{tag}", "sock": f"jhtbs-sock-{tag}"}
    broker = f"jhtbs-broker-{tag}"
    fails = 0

    def fail(tag_: str, message: str) -> None:
        nonlocal fails
        print(f"FAIL [{tag_}] {message}")
        fails += 1

    try:
        docker("run", "-d", "--name", broker, "--user", "1002:1002", "--read-only", "--tmpfs", "/tmp", *HARDENING,
               "--network", "none",
               "-v", f"{vols['secrets']}:/jht_secrets", "-v", f"{vols['state']}:/jht_broker_state",
               "-v", f"{vols['sock']}:/run/jht-broker",
               "--entrypoint", "/usr/bin/tini", image, "-g", "--", "/usr/local/bin/jht-broker", "serve")
        for _ in range(60):
            logs = docker("logs", broker, check=False)
            if "listening" in logs.stdout + logs.stderr:
                break
            time.sleep(0.5)
        else:
            fail("broker-start", "the broker did not start: " + docker("logs", broker, check=False).stderr[-500:])
            return 1

        def agent(uid: str, script: str) -> subprocess.CompletedProcess:
            return docker("run", "--rm", "--user", f"{uid}:{uid}", *HARDENING, "--network", "none",
                          "-e", "JHT_AGENT_NAME=scout", "-v", f"{vols['sock']}:/run/jht-broker:ro",
                          "--entrypoint", "python3", image, "-c", script, check=False)

        status = "import json,subprocess; print(subprocess.run(['python3','/app/shared/skills/email_monitor.py','status'],capture_output=True,text=True).stdout)"
        answer = agent("1001", status).stdout.strip()
        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            parsed = {}
        if not (parsed.get("ok") is True and parsed.get("configured") is False):
            fail("agent-answer", f"uid 1001 got {answer!r}")

        other = agent("1003", "from json import dumps; import sys; sys.path.insert(0,'/app/shared'); "
                              "from broker.client import call; print(dumps(call('mail.status')))").stdout.strip()
        if other != json.dumps({"ok": False, "reason": "peer_not_allowed"}):
            fail("peer", f"uid 1003 got {other!r}")

        plant = agent("1001", "import os\ntry:\n    open('/run/jht-broker/x','w')\n    print('WROTE')\n"
                              "except OSError as e:\n    print(e.errno)").stdout.strip()
        if plant == "WROTE":
            fail("socket-volume", "the agent could create a file next to the socket")

        seen = agent("1001", "import os; print(os.path.exists('/jht_secrets') or os.path.exists('/jht_broker_state'))")
        if seen.stdout.strip() != "False":
            fail("secret-volumes", "the broker's volumes are visible to the agent")

        # The login view's websockify, as view.py starts it, on the image's
        # own websockify: after one connection with a token its log holds
        # the connection and not the token (review note on the login view).
        ws_probe = (
            "import hashlib, json, os, socket, subprocess, sys, tempfile, time\n"
            "token = 'SmokeOneTimeToken-' + os.urandom(12).hex()\n"
            "run = tempfile.mkdtemp()\n"
            "open(run + '/token.json', 'w').write(json.dumps({'sha256': hashlib.sha256(token.encode()).hexdigest(),"
            " 'expires_at': time.time() + 60}))\n"
            "log = open(run + '/ws.log', 'wb')\n"
            "p = subprocess.Popen([sys.executable, '-m', 'broker.view_ws', '--token-plugin', 'broker.view_token.OneShot',"
            " '--run-once', '--token-source', run, '127.0.0.1:6081'], stdout=log, stderr=log,"
            " env={**os.environ, 'PYTHONPATH': '/app/shared'})\n"
            "for _ in range(100):\n"
            "    try:\n"
            "        c = socket.create_connection(('127.0.0.1', 6081), timeout=1); break\n"
            "    except OSError:\n"
            "        time.sleep(0.1)\n"
            "c.sendall(('GET /websockify?token=' + token + ' HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\n'"
            " 'Connection: Upgrade\\r\\nSec-WebSocket-Key: ' + 'A' * 22 + '==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n').encode())\n"
            "c.settimeout(3)\n"
            "try:\n"
            "    c.recv(4096)\n"
            "except OSError:\n"
            "    pass\n"
            "c.close(); time.sleep(0.5); p.terminate(); p.wait(10); log.close()\n"
            "text = open(run + '/ws.log', errors='replace').read()\n"
            "print('logged' if 'Path' in text else 'nothing-logged', 'leak' if token in text else 'clean')\n"
        )
        ws = docker("run", "--rm", "--user", "1002:1002", "--read-only", "--tmpfs", "/tmp", *HARDENING,
                    "--network", "none", "--entrypoint", "python3", image, "-c", ws_probe, check=False, timeout=120)
        if ws.stdout.strip() != "logged clean":
            fail("view-log", f"websockify after one connection: {ws.stdout.strip()!r} {ws.stderr[-300:]!r}")

        # A measurement, not a check (design R3): can Chromium start with its
        # own sandbox in the broker's conditions? The answer decides whether
        # the login view needs a seccomp/AppArmor profile or the operator's
        # written acceptance. It is printed, never turned into a failure.
        probe = (
            "from playwright.sync_api import sync_playwright as s\n"
            "p = s().start()\n"
            "try:\n"
            "    b = p.chromium.launch(headless=True, chromium_sandbox=True, args=['--disable-dev-shm-usage'])\n"
            "    b.close(); print('ok')\n"
            "except Exception as e:\n"
            "    print('unavailable')\n"
            "finally:\n"
            "    p.stop()\n"
        )
        measured = docker("run", "--rm", "--user", "1002:1002", "--read-only", "--tmpfs", "/tmp", *HARDENING,
                          "--network", "none", "-e", "HOME=/tmp", "--entrypoint", "python3", image, "-c", probe,
                          check=False, timeout=180)
        print(f"MEASURE chromium-sandbox={(measured.stdout.strip().splitlines() or ['unknown'])[-1]}")
    finally:
        docker("rm", "-f", broker, check=False)
        for vol in vols.values():
            docker("volume", "rm", "-f", vol, check=False)
    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
