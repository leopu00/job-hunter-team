#!/usr/bin/env python3
"""The seccomp profile of `jht-login` on Docker: the default profile of Docker, pinned, plus ONE rule.

Why. The browser of the manual LinkedIn sign-in keeps the sandbox of Chromium on. That sandbox makes a user namespace (with a pid and a net
namespace inside it) and chroots into an empty folder. Docker's default profile refuses the user namespace to a container that does not hold
CAP_SYS_ADMIN (clone and unshare with CLONE_NEWUSER fail with EPERM), so on Docker the browser does not start, whatever else it is given
(measured on Docker 28 on Linux and Docker 29 on Colima; Podman's default lets it through). The fix is a profile of our own for that one
container, never `seccomp=unconfined`.

What. shared/login/seccomp/moby-default.json is the file `seccomp/default.json` of github.com/moby/profiles at the commit named below, byte for
byte. shared/login/seccomp/jht-login.json is that file with one rule appended to `syscalls`:

    clone, unshare   ALLOW  when  flags & (CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWCGROUP) == 0     (not on s390/s390x)

That is the same form as the rule Docker already has for clone (which refuses all the namespace flags, mask 0x7E020000); ours leaves out of the
mask CLONE_NEWUSER, CLONE_NEWPID and CLONE_NEWNET, which are the three the sandbox asks for, so those three become possible and nothing else does:
a mount, uts, ipc or cgroup namespace is still refused; setns, mount, umount2, pivot_root and the other calls that Docker keeps behind
CAP_SYS_ADMIN stay refused; clone3 keeps answering ENOSYS (glibc and Chromium fall back to clone).

Cost, to be said where this is used: a user namespace inside the container gives a process in it capabilities over that namespace, which widens
what of the host's kernel it can reach (that is why Docker refuses it by default). The container has no network, a read-only root, no capability
beyond SYS_CHROOT, no-new-privileges and a user that is not root; the browser's own sandbox is what the namespaces are for.

    login_seccomp.py build      writes jht-login.json from moby-default.json (the test fails when the committed file is not exactly that)
    login_seccomp.py diff       prints what jht-login.json adds to the default, as JSON
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "shared" / "login" / "seccomp"
BASE = DIRECTORY / "moby-default.json"
PROFILE = DIRECTORY / "jht-login.json"

MOBY_PROFILES_COMMIT = "7b5ccfab2d6b4e0aa64c6cce401a2705788eafeb"  # github.com/moby/profiles, seccomp/default.json, 2026-11-02
BASE_SHA256 = "15434cc9c9037d85b35027a60721bf45f381782b4283b01d94663366e71569f8"

CLONE_NEWNS = 0x00020000
CLONE_NEWCGROUP = 0x02000000
CLONE_NEWUTS = 0x04000000
CLONE_NEWIPC = 0x08000000
CLONE_NEWUSER = 0x10000000
CLONE_NEWPID = 0x20000000
CLONE_NEWNET = 0x40000000
REFUSED_STILL = CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWCGROUP

RULE = {
    "names": ["clone", "unshare"],
    "action": "SCMP_ACT_ALLOW",
    "args": [{"index": 0, "value": REFUSED_STILL, "op": "SCMP_CMP_MASKED_EQ"}],
    "comment": "the user, pid and net namespaces that the sandbox of Chromium makes; mount, uts, ipc and cgroup namespaces stay refused",
    "excludes": {"arches": ["s390", "s390x"]},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build() -> str:
    profile = json.loads(BASE.read_text(encoding="utf-8"))
    profile["syscalls"].append(RULE)
    return json.dumps(profile, indent=2) + "\n"


def added() -> list[dict]:
    base = json.loads(BASE.read_text(encoding="utf-8"))["syscalls"]
    ours = json.loads(PROFILE.read_text(encoding="utf-8"))["syscalls"]
    return [rule for rule in ours if rule not in base]


def main(argv: list[str]) -> int:
    if argv == ["build"]:
        PROFILE.write_text(build(), encoding="utf-8")
        print(f"wrote {PROFILE.relative_to(ROOT)} sha256 {sha256(PROFILE)}")
        return 0
    if argv == ["diff"]:
        print(json.dumps(added(), indent=2))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
