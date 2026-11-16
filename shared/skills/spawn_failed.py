#!/usr/bin/env python3
"""spawn_failed.py — the roles that cannot start, for `jht team status` and `jht doctor` (cli/src/lib/spawn-failed.js).

The watchdog of the Dottore and the Mantenitore (.launcher/doctor-watchdog.sh) calls it after every start:

  python3 spawn_failed.py <file> <role> <rc> <output of the spawner>   a start that failed: when, its exit code, the error line
  python3 spawn_failed.py <file> <role> ok                             a start that went well: the role goes out

Only the last line that says an error (or the last line), without control characters and cut at 240 characters: never the
pane, never a value of the configuration. The file is written whole (a temporary file, then a rename). Exit 0 always but for
wrong arguments (2): a file that cannot be written is the watchdog's to log, not a reason to stop it.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import datetime

ROLES = ("dottore", "mantenitore")


def update(path: str, role: str, rc: str, text: str = "") -> None:
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        data = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        data = {}
    if rc == "ok":
        if role not in data:
            return
        data.pop(role, None)
    else:
        lines = [line for line in text.splitlines() if re.search(r"\b(ERROR|Error|error)\b", line)] or text.splitlines() or [""]
        why = re.sub(r"[\x00-\x1f\x7f]", "", lines[-1]).strip()[:240]
        data[role] = {"at": datetime.now().astimezone().isoformat(timespec="seconds"),
                      "rc": int(rc) if rc.isdigit() else None, "why": why}
    folder = os.path.dirname(path) or "."
    os.makedirs(folder, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=folder, prefix=".spawn-failed.")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(data, out, ensure_ascii=False)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv: list[str]) -> int:
    if len(argv) < 4 or argv[2] not in ROLES or (argv[3] != "ok" and not argv[3].isdigit()):
        print("usage: spawn_failed.py <file> dottore|mantenitore <rc> <output> | <file> <role> ok", file=sys.stderr)
        return 2
    try:
        update(argv[1], argv[2], argv[3], argv[4] if len(argv) > 4 else "")
    except OSError as error:
        print("spawn-failed.json not written: %s" % error, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
