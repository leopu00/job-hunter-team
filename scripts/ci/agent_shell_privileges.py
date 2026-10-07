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

# Runs inside the container. Every FAIL line starts with a stable tag in
# brackets: the tests assert on the tags, so a reworded message does not turn
# a working check into a red test, or a broken one into a green test.
#
# Busybox images expose `id` as an applet of one binary, picked from argv[0]
# or, when argv[0] is `busybox`, from argv[1]. The setuid copy therefore keeps
# the name `busybox`: under any other name it answers "applet not found", the
# probe prints nothing, and the check would pass without having run.
INSIDE = r"""
set -u
fails=0
fail() { echo "FAIL [$1] $2"; fails=$((fails + 1)); }
if sudo -n true 2>/dev/null; then fail sudo "sudo -n true succeeded"; fi
uid="$(id -u)"
[ "$uid" = 1001 ] || fail uid "id -u is $uid, not 1001"
capeff="$(awk '/^CapEff:/ {print $2}' /proc/self/status)"
[ "$capeff" = 0000000000000000 ] || fail capeff "CapEff is $capeff"
nnp="$(awk '/^NoNewPrivs:/ {print $2}' /proc/self/status)"
[ "$nnp" = 1 ] || fail nnp "NoNewPrivs is $nnp"
touch /jht_home/probe || fail write "cannot write in /jht_home"
if chown 0:0 /jht_home/probe 2>/dev/null; then fail chown "chown 0 succeeded"; fi
idbin="$(command -v id)"
real="$(readlink -f "$idbin" 2>/dev/null || echo "$idbin")"
mkdir -p /jht_home/suid
case "$real" in
  *busybox*) probe=/jht_home/suid/busybox ;;
  *) probe=/jht_home/suid/id ;;
esac
cp "$real" "$probe" && chmod u+s "$probe" || fail setuid-prepare "cannot prepare the setuid probe"
case "$probe" in
  */busybox) euid="$("$probe" id -u 2>/dev/null)" ;;
  *) euid="$("$probe" -u 2>/dev/null)" ;;
esac
case "$euid" in
  '') fail setuid-probe "the setuid probe did not run" ;;
  0) fail setuid "a setuid file in /jht_home ran as uid 0" ;;
esac
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
                print(f"FAIL [host-root] host sees {path.name} owned by root")
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
