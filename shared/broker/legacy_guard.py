"""The runtime's guard of the legacy mailbox files (audit G1).

After the one migration, `/jht_home/credentials/email_monitor.json` and
`email_transport.json` must not come back: anything in the agents' container
(an agent, an old desktop writing the folder) could put one there, and a
reader that trusted it would open the door the broker closed. Nothing in jht
reads those files any more; this guard also makes them not stay.

`legacy_guard.py sweep` asks the broker (`mail.status`, role `runtime`) which
names are past their migration and, for each of those whose file is there,
deletes it **without opening it** (lstat and unlink only: no read, no import),
then tells the user to save the mailbox with `jht mail setup`. A name the
broker has not migrated yet is left alone: on the first boot after an upgrade
the host's migration still has to take it. No broker, no deletion.

pid1 runs a sweep at boot and then periodically. Output: one JSON line,
`{"ok": true, "removed": [...]}`; never a path content.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from broker.client import call  # noqa: E402
from broker.legacy import NAMES, legacy_path  # noqa: E402

RUNTIME_ROLE = "runtime"
NOTICE = (
    "A mailbox password file reappeared in the agents' folder "
    "(credentials/{names}) after it had been moved to the secrets broker. "
    "It was deleted without being read. To change the mailbox account, run "
    "`jht mail setup` on your computer."
)


def _default_notify(names: list[str]) -> None:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        return
    message = NOTICE.format(names=", ".join(f"{name}.json" for name in names))
    subprocess.run(
        [executable, "--agent", "assistente", "--kind", "alert", message],
        check=False, capture_output=True, text=True, timeout=30,
    )


def sweep(
    ask: Callable[..., dict] = call,
    notify: Callable[[list[str]], None] = _default_notify,
) -> dict:
    answer = ask("mail.status", {}, role=RUNTIME_ROLE)
    if not answer.get("ok"):
        return {"ok": False, "reason": str(answer.get("reason", "broker_bad_answer")), "removed": []}
    migrated = answer.get("legacy_migrated")
    if not isinstance(migrated, dict):
        return {"ok": False, "reason": "broker_bad_answer", "removed": []}
    removed, failed = [], []
    for name in NAMES:
        if migrated.get(name) is not True:
            continue
        path = legacy_path(name)
        if not os.path.lexists(path):
            continue
        try:
            os.unlink(path)  # a symlink goes, its target is never followed
        except FileNotFoundError:
            continue
        except OSError:
            failed.append(name)
            continue
        removed.append(name)
    if removed:
        try:
            notify(removed)
        except (OSError, subprocess.SubprocessError):
            pass  # the deletion is what matters; the notice is best effort
    result: dict = {"ok": not failed, "removed": removed}
    if failed:
        result["reason"] = "legacy_remove_failed"
        result["failed"] = failed
    return result


def main(argv: list[str]) -> int:
    if argv != ["sweep"]:
        print(json.dumps({"ok": False, "reason": "usage"}), file=sys.stderr)
        return 2
    result = sweep()
    print(json.dumps(result))
    return 0 if result["ok"] or result.get("reason") in ("broker_unavailable", "broker_unreachable") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
