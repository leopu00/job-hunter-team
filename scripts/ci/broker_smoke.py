#!/usr/bin/env python3
"""The portal-secrets broker, on the real image (P1 portal secrets, phase 1a).

Starts IMAGE as the compose starts `jht-broker` (uid 1002, read-only root,
no capabilities, no new privileges, the three named volumes) and, as the
agents (uid 1001, socket volume read-only), asks it `mail.status`:

  - uid 1001 gets a broker answer (`configured: false` on fresh volumes);
  - uid 1003 gets `peer_not_allowed`;
  - from uid 1001 the socket volume refuses a new file;
  - the broker's secret and state volumes are not in the agent's filesystem:
    the image has both directories (empty, 0700, owned by the broker, so a
    fresh named volume copies that owner and mode at its first mount), so
    the check is that neither is a mount and neither lists any entry to the
    agent. A control run with the secrets volume mounted by mistake into an
    agent must be caught, or the check proves nothing;
  - on the broker, the fresh volumes carry the image's owner and mode.

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
SECRET_DIRS = ("/jht_secrets", "/jht_broker_state")

# Runs in an agent container: argv[1] is the mount table, the rest are the
# broker's directories. Prints, as JSON, each one the agent could reach: a
# mount, or a directory whose entries it can list. An empty or unreadable
# directory of the image is not a volume and holds nothing.
SECRET_DIRS_PROBE = r"""
import json, os, sys
mountinfo, dirs = sys.argv[1], sys.argv[2:]
with open(mountinfo) as table:
    mounted = {line.split()[4] for line in table if len(line.split()) > 4}
found = {}
for path in dirs:
    if path in mounted:
        found[path] = "mounted"
        continue
    try:
        entries = os.listdir(path)
    except (FileNotFoundError, PermissionError):
        continue
    if entries:
        found[path] = f"lists {len(entries)} entries"
print(json.dumps(found))
"""

# Runs in the broker container: owner and mode of its two volumes.
VOLUME_OWNER = (
    "import json, os, sys; "
    "print(json.dumps({p: [os.stat(p).st_uid, oct(os.stat(p).st_mode & 0o777)] for p in sys.argv[1:]}))"
)


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

        def agent(uid: str, script: str, *args: str, mounts: tuple[str, ...] = ()) -> subprocess.CompletedProcess:
            return docker("run", "--rm", "--user", f"{uid}:{uid}", *HARDENING, "--network", "none",
                          "-e", "JHT_AGENT_NAME=scout", "-v", f"{vols['sock']}:/run/jht-broker:ro", *mounts,
                          "--entrypoint", "python3", image, "-c", script, *args, check=False)

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

        owners = docker("exec", broker, "python3", "-c", VOLUME_OWNER, *SECRET_DIRS, check=False).stdout.strip()
        if owners != json.dumps({path: [1002, "0o700"] for path in SECRET_DIRS}):
            fail("volume-owner", f"the broker's fresh volumes are {owners!r}, not 1002 and 0700")

        seen = agent("1001", SECRET_DIRS_PROBE, "/proc/self/mountinfo", *SECRET_DIRS).stdout.strip()
        if seen != "{}":
            fail("secret-volumes", f"the broker's volumes reach the agent: {seen!r}")
        mistake = agent("1001", SECRET_DIRS_PROBE, "/proc/self/mountinfo", *SECRET_DIRS,
                        mounts=("-v", f"{vols['secrets']}:/jht_secrets:ro")).stdout.strip()
        if mistake != json.dumps({"/jht_secrets": "mounted"}):
            fail("secret-volumes-control", f"the secrets volume mounted into an agent was not caught: {mistake!r}")
    finally:
        docker("rm", "-f", "-v", broker, check=False)
        for vol in vols.values():
            docker("volume", "rm", "-f", vol, check=False)
    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
