#!/usr/bin/env python3
"""32-bit code against the broker's seccomp profile, on a real Linux (CI).

The security review (09/10): 32-bit code (int 0x80 on x86_64, AArch32 on
arm64) and socketcall reached AF_ALG and AF_VSOCK past the profile's
socket() rules, and under rootless Podman no AppArmor stops them. The
profile now has no 32-bit sub-architecture on x86_64 and aarch64, and
refuses socketcall. This gate runs scripts/ci/compat32_socket.c.txt, built
static for this host's 32-bit mode, in a container of its own:

- CONTROL, with seccomp unconfined: what 32-bit code opens on this kernel.
  If the 32-bit binary does not run at all (a CPU without AArch32, a kernel
  without IA32 emulation), the gate says so: nothing to prove here;
- WITH the profile: nothing may open. FAILS otherwise.

Under Docker the runs use `apparmor=unconfined`, so that docker-default's
`deny network alg/vsock` cannot hide what seccomp lets through.

With --image-check IMAGE it also checks that Chromium and the broker's
Python in IMAGE have no 32-bit ELF file (they never need a 32-bit path).

Usage: compat32_gate.py ENGINE SECCOMP_JSON BINARY [--image-check IMAGE]
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path

TAG = "localhost/jht-compat32:ci"
WAYS = {1: "socketcall AF_ALG", 2: "socket AF_ALG", 4: "socketcall AF_VSOCK", 8: "socket AF_VSOCK"}

# Runs in IMAGE: 32-bit ELF files where Chromium and the broker's Python live.
SCAN = r'''
import json, os, sys, sysconfig
roots = {"/opt/playwright", os.path.realpath(sys.executable)}
roots |= {sysconfig.get_paths()[k] for k in ("stdlib", "platstdlib", "purelib", "platlib")}
roots.add(os.path.join(sysconfig.get_paths()["platstdlib"], "lib-dynload"))
found, seen = [], 0
def check(path):
    global seen
    try:
        with open(path, "rb") as f:
            head = f.read(5)
    except OSError:
        return
    if head[:4] == b"\x7fELF":
        seen += 1
        if head[4] == 1:
            found.append(path)
for root in sorted(roots):
    if os.path.isfile(root):
        check(root)
    for top, _, files in os.walk(root):
        for name in files:
            path = os.path.join(top, name)
            if os.path.isfile(path) and not os.path.islink(path):
                check(path)
print(json.dumps({"roots": sorted(roots), "elf_files": seen, "elf32": found[:20], "elf32_count": len(found),
                  "i386_libs": os.path.isdir("/usr/lib/i386-linux-gnu"), "armhf_libs": os.path.isdir("/usr/lib/arm-linux-gnueabihf")}))
'''


def opened(code: int) -> list[str]:
    return [way for bit, way in WAYS.items() if 16 <= code <= 31 and (code - 16) & bit]


def make_image(engine: str, binary: Path) -> None:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        info = tarfile.TarInfo("compat32")
        data = binary.read_bytes()
        info.size, info.mode = len(data), 0o755
        tar.addfile(info, io.BytesIO(data))
    subprocess.run([engine, "import", "-", TAG], input=buffer.getvalue(), check=True, capture_output=True, timeout=120)


def run(engine: str, seccomp: str) -> int:
    extra = ["--security-opt", "apparmor=unconfined"] if engine == "docker" else []
    result = subprocess.run([engine, "run", "--rm", "--user", "1002:1002", "--cap-drop", "ALL",
                             "--security-opt", "no-new-privileges", "--network", "none", *extra,
                             "--security-opt", f"seccomp={seccomp}", TAG, "/compat32"],
                            capture_output=True, text=True, timeout=120)
    if result.stderr.strip():
        print(f"  {engine} said: {result.stderr.strip()[-300:]}")
    return result.returncode


def image_check(engine: str, image: str) -> dict:
    result = subprocess.run([engine, "run", "--rm", "--network", "none", "--entrypoint", "python3", image, "-c", SCAN],
                            capture_output=True, text=True, timeout=600)
    lines = result.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"error": result.stderr[-400:]}
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-400:]}


def main(argv: list[str]) -> int:
    image = None
    if "--image-check" in argv:
        at = argv.index("--image-check")
        image = argv[at + 1] if at + 1 < len(argv) else None
        argv = argv[:at] + argv[at + 2:]
        if not image:
            print(__doc__, file=sys.stderr)
            return 2
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    engine, seccomp, binary = argv
    fails = 0

    def fail(tag: str, message: str) -> None:
        nonlocal fails
        print(f"FAIL [{tag}] {message}")
        fails += 1

    make_image(engine, Path(binary))
    control = run(engine, "unconfined")
    print(f"MEASURE {engine}-compat32-control exit={control} opened={opened(control)}")
    profiled = run(engine, seccomp)
    print(f"MEASURE {engine}-compat32-profile exit={profiled} opened={opened(profiled)}")
    if not 16 <= control <= 31:
        print(f"MEASURE {engine}-compat32 not provable here: 32-bit code does not run on this host (exit {control})")
    elif not opened(control):
        print(f"MEASURE {engine}-compat32 not provable here: this kernel opens neither family for 32-bit code")
    if opened(profiled):
        fail("compat32", f"under the profile, 32-bit code opened: {', '.join(opened(profiled))}")
    elif 16 <= control <= 31 and not (profiled == 16 or profiled >= 128):
        # The binary ran unfiltered; under the profile it must report "all
        # refused" (16) or be killed by a signal at its first 32-bit call.
        fail("compat32-run", f"under the profile the 32-bit probe ended with exit {profiled}: no answer")

    if image:
        scan = image_check(engine, image)
        print(f"MEASURE {engine}-image-32bit " + json.dumps(scan))
        if "error" in scan:
            fail("image-check", f"the image scan gave no answer: {scan['error']}")
        elif scan.get("elf_files", 0) == 0:
            fail("image-check", "the scan found no ELF file at all: it looked in the wrong places")
        elif scan.get("elf32_count"):
            fail("image-32bit", f"32-bit ELF files where Chromium or the broker's Python live: {scan['elf32']}")

    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
