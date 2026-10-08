"""The legacy mailbox files under `/jht_home/credentials`, for the migration.

Run by the host wrapper with `exec` in the agents' container, because those
files belong to the agents' uid and the host user may not read them. It never
prints the content in clear: `read` prints one envelope line
`{"sha256": ..., "b64": ...}` that the wrapper pipes straight into
`jht-broker-admin secrets import-legacy`, and the broker checks the digest.

    legacy.py exists <name>   exit 0 if the file is there
    legacy.py read <name>     the envelope on stdout
    legacy.py remove <name>   delete it (after the broker confirmed)
"""

from __future__ import annotations

import base64
import errno
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

NAMES = ("email_monitor", "email_transport")
MAX_BYTES = 64 * 1024


def legacy_path(name: str) -> Path:
    return Path(os.environ.get("JHT_HOME", "/jht_home")) / "credentials" / f"{name}.json"


def read_envelope(name: str) -> dict:
    try:
        fd = os.open(legacy_path(name), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return {"ok": False, "reason": "absent"}
    except OSError as exc:
        return {"ok": False, "reason": "symlink" if exc.errno == errno.ELOOP else "unreadable"}
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > MAX_BYTES:
            return {"ok": False, "reason": "not_a_regular_own_file"}
        raw = os.read(fd, MAX_BYTES + 1)
    finally:
        os.close(fd)
    return {"ok": True, "sha256": hashlib.sha256(raw).hexdigest(), "b64": base64.b64encode(raw).decode("ascii")}


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("exists", "read", "remove") or argv[1] not in NAMES:
        print(json.dumps({"ok": False, "reason": "usage"}), file=sys.stderr)
        return 2
    action, name = argv
    path = legacy_path(name)
    if action == "exists":
        return 0 if os.path.lexists(path) else 1
    if action == "read":
        envelope = read_envelope(name)
        print(json.dumps(envelope))
        return 0 if envelope.get("ok") else 1
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    print(json.dumps({"ok": True, "removed": name}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
