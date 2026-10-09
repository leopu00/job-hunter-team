#!/usr/bin/env python3
"""No 32-bit ELF file in the JHT image, for a given platform (CI).

The broker's seccomp profile has no 32-bit sub-architecture on x86_64 and
aarch64: a 32-bit call meets the wrong-architecture action. That is safe
only if nothing in the image needs 32-bit code. This check reads the image's
filesystem as a tar (`docker export` of a container that is created, never
started) and the first bytes of every regular file: a static read, so an
emulated platform (arm64 on an amd64 runner) answers as truly as a native
one. Nothing in the image runs.

FAILS when any ELF file of class 32 is in the image, or when the scan saw no
ELF file at all (it would have looked at nothing).

Usage: image_elf32.py IMAGE [--platform linux/arm64]
"""

from __future__ import annotations

import json
import subprocess
import sys
import tarfile
from typing import IO

MACHINES = {3: "i386", 40: "arm", 62: "x86_64", 183: "aarch64"}


def scan(stream: IO[bytes]) -> dict:
    """ELF files of the tar stream, by class and machine."""
    elf, elf32, machines = 0, [], {}
    with tarfile.open(fileobj=stream, mode="r|") as tar:
        for member in tar:
            if not member.isreg() or member.size < 20:
                continue
            handle = tar.extractfile(member)
            head = handle.read(20) if handle else b""
            if head[:4] != b"\x7fELF":
                continue
            elf += 1
            order = "little" if head[5] == 1 else "big"
            machine = MACHINES.get(int.from_bytes(head[18:20], order), str(int.from_bytes(head[18:20], order)))
            machines[machine] = machines.get(machine, 0) + 1
            if head[4] == 1:
                elf32.append(f"/{member.name} ({machine})")
    return {"elf_files": elf, "elf32_count": len(elf32), "elf32": elf32[:30], "machines": machines}


def export(image: str, platform: str | None) -> dict:
    created = subprocess.run(["docker", "create", *(["--platform", platform] if platform else []), image],
                             capture_output=True, text=True, timeout=120)
    if created.returncode != 0:
        return {"error": created.stderr[-400:]}
    container = created.stdout.strip()
    try:
        proc = subprocess.Popen(["docker", "export", container], stdout=subprocess.PIPE)
        result = scan(proc.stdout)
        proc.stdout.close()
        if proc.wait(timeout=600) != 0:
            return {"error": f"docker export exited {proc.returncode}"}
        return result
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True, timeout=120)


def main(argv: list[str]) -> int:
    platform = None
    if "--platform" in argv:
        at = argv.index("--platform")
        platform = argv[at + 1] if at + 1 < len(argv) else None
        argv = argv[:at] + argv[at + 2:]
        if not platform:
            print(__doc__, file=sys.stderr)
            return 2
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    image = argv[0]
    result = export(image, platform)
    print(f"MEASURE image-elf {platform or 'native'} " + json.dumps(result))
    if "error" in result:
        print(f"FAIL [export] the image could not be read: {result['error']}")
        return 1
    if result["elf_files"] == 0:
        print("FAIL [scan] no ELF file at all: the scan read nothing")
        return 1
    if result["elf32_count"]:
        print(f"FAIL [elf32] {result['elf32_count']} 32-bit ELF files in the image: {result['elf32']}")
        return 1
    print("checks done: 0 failed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
