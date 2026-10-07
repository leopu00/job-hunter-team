#!/usr/bin/env python3
"""From an agent's shell, nothing leads to root (P1 sudo, 08/10).

Starts IMAGE the way the compose starts the agents' container — the
`security_opt` and `cap_drop` of the `jht` service, as `docker compose
config` resolves docker-compose.yml — and a host folder mounted at /jht_home — and runs, as the
image's own user:

  - `sudo -n true` fails;
  - `id -u` is 1001;
  - CapEff in /proc/self/status is 0, and NoNewPrivs is 1;
  - `chown 0` on a file in /jht_home fails;
  - a copy of `id` made setuid in /jht_home does not run as uid 0.

Then, from the host, no file in the mounted folder is owned by root.

Used by .github/workflows/docker.yml on the image just built, before it is
pushed, and by tests/test_agent_shell_privileges.py on a small image with the
same flags (plus a deliberately unsafe control run that must be caught).

Usage:
  agent_shell_privileges.py IMAGE [--user UID:GID] [--unsafe-control]
Exit 0 when every check passes; 1 with one FAIL line per broken check.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker-compose.yml"

# Runs inside the container. Busybox images expose `id` as an applet of one
# binary: the setuid copy is then called with the applet name first.
INSIDE = r"""
set -u
fails=0
fail() { echo "FAIL $*"; fails=$((fails + 1)); }
if sudo -n true 2>/dev/null; then fail "sudo -n true succeeded"; fi
uid="$(id -u)"
[ "$uid" = 1001 ] || fail "id -u is $uid, not 1001"
capeff="$(awk '/^CapEff:/ {print $2}' /proc/self/status)"
[ "$capeff" = 0000000000000000 ] || fail "CapEff is $capeff"
nnp="$(awk '/^NoNewPrivs:/ {print $2}' /proc/self/status)"
[ "$nnp" = 1 ] || fail "NoNewPrivs is $nnp"
touch /jht_home/probe || fail "cannot write in /jht_home"
if chown 0:0 /jht_home/probe 2>/dev/null; then fail "chown 0 succeeded"; fi
idbin="$(command -v id)"
real="$(readlink -f "$idbin" 2>/dev/null || echo "$idbin")"
cp "$real" /jht_home/suid-id && chmod u+s /jht_home/suid-id || fail "cannot prepare the setuid probe"
case "$real" in
  *busybox*) euid="$(/jht_home/suid-id id -u)" ;;
  *) euid="$(/jht_home/suid-id -u)" ;;
esac
[ "$euid" != 0 ] || fail "a setuid file in /jht_home ran as uid 0"
echo "checks done: $fails failed"
[ "$fails" = 0 ]
"""


def compose_flags() -> list[str]:
    """The jht service's security_opt and cap_drop as compose resolves them."""
    resolved = subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE), "config", "--format", "json"],
        capture_output=True, text=True, check=True, timeout=60,
        env={**os.environ, "HOME": os.environ.get("HOME") or tempfile.gettempdir()},
    )
    service = json.loads(resolved.stdout)["services"]["jht"]
    flags: list[str] = []
    for opt in service.get("security_opt") or []:
        flags += ["--security-opt", str(opt)]
    for cap in service.get("cap_drop") or []:
        flags += ["--cap-drop", str(cap)]
    return flags


def run(image: str, user: str | None, unsafe_control: bool) -> int:
    with tempfile.TemporaryDirectory(prefix="jht-agent-shell-") as tmp:
        mount = Path(tmp)
        # The container user must be able to write in it, whatever the host uid.
        os.chmod(mount, 0o777)
        cmd = ["docker", "run", "--rm", "--network", "none", "--entrypoint", "/bin/sh"]
        if unsafe_control:
            # What the checks must catch: root, default capabilities, no flags.
            cmd += ["--user", "0:0"]
        else:
            cmd += compose_flags()
            if user:
                cmd += ["--user", user]
        cmd += ["-v", f"{mount}:/jht_home", image, "-c", INSIDE]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        code = 0 if result.returncode == 0 else 1
        # From the host: nothing the container wrote may belong to root.
        for path in mount.rglob("*"):
            info = path.lstat()
            if info.st_uid == 0:
                print(f"FAIL host sees {path.name} owned by root")
                code = 1
        # The probes are removed with the folder; a setuid copy owned by root
        # cannot outlive the temporary directory either.
        if unsafe_control:
            subprocess.run(
                ["docker", "run", "--rm", "--user", "0:0", "--entrypoint", "/bin/sh",
                 "-v", f"{mount}:/jht_home", image, "-c", "rm -rf /jht_home/*"],
                capture_output=True, timeout=60,
            )
        return code


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("image")
    parser.add_argument("--user", help="UID:GID to run as (default: the image's USER)")
    parser.add_argument("--unsafe-control", action="store_true", help="run as root without the compose flags")
    args = parser.parse_args(argv)
    return run(args.image, args.user, args.unsafe_control)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
