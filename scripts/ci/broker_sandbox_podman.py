#!/usr/bin/env python3
"""The broker's login browser under ROOTLESS Podman: the CI gate of
the security review's decision (a) of 09/10 (stage 1 of the Podman plan).

Rootless Podman applies no AppArmor profile and refuses a container that
asks for one (measured: Podman 4.9.3, exit 125). There the broker runs with
the seccomp profile alone, and `confinement()` accepts it only in a verified
rootless container (uid 0 inside is not uid 0 outside), with Seccomp 2,
NoNewPrivs 1 and no effective capability.

Runs, as a NON-ROOT user:
- PODMAN_IMAGE under rootless Podman, as the wrapper starts the broker there
  (the hardening of broker_sandbox.py, the seccomp profile, no AppArmor
  option). FAILS unless:
  - Podman is rootless;
  - `confinement()` says ready;
  - Chromium starts with its sandbox: chrome://sandbox read as sandboxed, no
    `--no-sandbox`, a renderer in a user namespace of its own;
  - from the broker's Python: no mount namespace, no chroot, no AF_ALG and
    no AF_VSOCK socket (what AppArmor's `deny network alg/vsock` gave).
    A socket check counts only where the kernel opens that family without
    the filter (a control run, seccomp unconfined); elsewhere it is printed
    as not provable;
- DOCKER_IMAGE under rootful Docker with the same seccomp profile and no
  jht-broker label: a container that is NOT rootless. FAILS unless the
  broker stays off (`secure_browser_unavailable`).

Usage: broker_sandbox_podman.py PODMAN_IMAGE DOCKER_IMAGE SECCOMP_JSON
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("broker_sandbox", Path(__file__).with_name("broker_sandbox.py"))
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

OFF = {"ready": False, "reason": "secure_browser_unavailable"}

# The control: which of the two families this kernel opens with no filter.
SOCKETS = r'''
import json, socket
def works(family, kind):
    try:
        socket.socket(family, kind).close()
        return True
    except OSError:
        return False
print(json.dumps({"af_alg": works(38, socket.SOCK_SEQPACKET), "af_vsock": works(40, socket.SOCK_STREAM)}))
'''


def podman_info() -> dict:
    result = subprocess.run(["podman", "info", "--format", "json"], capture_output=True, text=True, timeout=120)
    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"error": result.stderr[-400:]}
    host = info.get("host", {})
    security = host.get("security", {})
    return {
        "version": info.get("version", {}).get("Version"),
        "rootless": security.get("rootless"),
        "apparmor_enabled": security.get("apparmorEnabled"),
        "seccomp_enabled": security.get("seccompEnabled"),
        "oci_runtime": host.get("ociRuntime", {}).get("name"),
    }


def socket_control(image: str) -> dict:
    result = subprocess.run(["podman", "run", "--rm", *gate.HARDENING, "--security-opt", "seccomp=unconfined",
                             "--entrypoint", "python3", image, "-c", SOCKETS],
                            capture_output=True, text=True, timeout=120)
    lines = result.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"error": result.stderr[-400:]}
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-400:]}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    podman_image, docker_image, seccomp = argv
    fails = 0

    def fail(tag: str, message: str) -> None:
        nonlocal fails
        print(f"FAIL [{tag}] {message}")
        fails += 1

    info = podman_info()
    print("MEASURE podman " + json.dumps(info))
    if info.get("rootless") is not True:
        fail("rootless", f"Podman is not rootless here: the gate would check another case ({info})")

    got = gate.run(podman_image, ["--security-opt", f"seccomp={seccomp}"], engine="podman")
    print("MEASURE rootless " + json.dumps(got))
    print(f"MEASURE rootless-label broker={got.get('own_label')!r} chromium={got.get('chromium_labels')}")
    if "error" in got:
        fail("probe", f"the probe gave no answer under rootless Podman: {got['error']}")
    elif got.get("confinement", {}).get("ready") is not True:
        fail("confinement", f"the broker does not see itself confined under rootless Podman: {got.get('confinement')}")
    elif got.get("launch") != "ok":
        fail("launch", f"Chromium did not start with its sandbox: {got.get('launch_error')}")
        for line in got.get("browser_log") or []:
            print("  browser: " + line)
        alone = got.get("chrome_alone") or {}
        print(f"  chrome alone: exit {alone.get('exit')}")
        for line in alone.get("stderr") or []:
            print("  chrome: " + line)
    else:
        if got.get("no_sandbox_flag"):
            fail("flag", "a Chromium process runs with --no-sandbox")
        if got.get("sandboxed") is not True:
            fail("chrome-sandbox", f"chrome://sandbox: {got.get('sandbox_text')}")
        if not got.get("renderer_userns"):
            fail("renderer-userns", "no renderer process was found: the probe could not compare namespaces")
        elif got.get("renderer_in_own_userns") is not True:
            fail("renderer-userns", f"renderers {got.get('renderer_userns')} vs own {got.get('own_userns')}")
    if "error" not in got:
        if got.get("python_unshare_mount") is not False:
            fail("python-mountns", "the broker's Python created a mount namespace")
        if got.get("python_chroot") is not False:
            fail("python-chroot", "the broker's Python chrooted without a user namespace of its own")
        control = socket_control(podman_image)
        print("MEASURE socket-control-unfiltered " + json.dumps(control))
        for family in ("af_alg", "af_vsock"):
            name = family.replace("_", "-")
            if got.get(f"python_{family}") is not False:
                fail(f"python-{name}", f"the broker's Python opened an {family.upper()} socket")
            elif control.get(family) is not True:
                print(f"MEASURE python-{name}=refused, not provable here: the kernel does not open it unfiltered either")

    rootful = gate.run(docker_image, ["--security-opt", f"seccomp={seccomp}"], engine="docker")
    print("MEASURE rootful-without-label " + json.dumps(rootful))
    if rootful.get("confinement") != OFF:
        fail("rootful", f"a rootful container without the jht-broker label is not off: {rootful.get('confinement') or rootful.get('error')}")

    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
