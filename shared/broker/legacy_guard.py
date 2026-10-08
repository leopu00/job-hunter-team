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

Then, for each migrated name, it puts a PLACEHOLDER where the file was (audit
G1-r1): an empty read-only directory (0555) with that name, at the file's path and at the two temporary names the old clients write first
(`.tmp` on a VPS, `.game-tmp` on the desktop). A client of v0.3.9 that saves
the mailbox again then fails on its first open, and the password never
reaches the disk. The deletion above stays as the second defence, should a
placeholder be removed. Empty on purpose: `jht reset` and any `rm -r` can
delete an empty 0555 directory, not one with a file inside. If `credentials/`
itself is missing, the guard creates it (0700) first, as the old clients
would.

Declared residue (G1-r1): the placeholder belongs to uid 1001, the agents'
own uid. Inside `jht` nothing else can create it (no root, every capability
dropped), and a root helper container was ruled out. An agent can therefore
loosen it with chmod and remove it; the next sweep, within 30 s, deletes a
file found in its place unread and puts the placeholder back. The threat the
placeholder closes is the old client's save, which does not remove it.

Declared residue (G1-r4): the password a client of v0.3.9 saved does not
enter the broker's exposed list. Nothing reads the reappeared file: an
operation that let the broker read it (and restart the rotation on a match)
answered agents differently by the file's content, since the role on the
socket is the client's word and the uid is the guard's, so it was a password
oracle and was removed (review R1). The user's notice says the password is
exposed and must be rotated; the release notes say it too.

pid1 runs a sweep at boot and then periodically. Output: one JSON line,
`{"ok": true, "removed": [...], "placeholders": [...]}`; never a path content.
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
from broker.legacy import NAMES, PLACEHOLDER_SUFFIXES, is_placeholder, legacy_path  # noqa: E402

RUNTIME_ROLE = "runtime"
# Audit G1-r4: an old client (v0.3.9) passes the password to the agents'
# container on a command line other processes there can read. A password
# saved that way is exposed, whatever happened to the file afterwards.
NOTICE = (
    "A mailbox password file reappeared in the agents' folder "
    "(credentials/{names}) after it had been moved to the secrets broker. "
    "It was deleted without being read. If you saved the mailbox from an old "
    "version of the app, treat that password as EXPOSED: create a new app "
    "password with your mail provider, then save it on your computer with "
    "`jht mail setup`."
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


def _place(path: Path) -> bool:
    """An empty 0555 directory at `path`, which is free. False when something
    got there first (the next sweep looks again)."""
    try:
        os.mkdir(path, 0o555)
    except FileExistsError:
        return False
    os.chmod(path, 0o555)  # mkdir's mode goes through the umask
    return True


def _clear(path: Path) -> str | None:
    """Make `path` free for a placeholder without opening what is there:
    `removed` for a file or link, `kept` for a placeholder or for another
    directory (writes fail on it anyway), None when it was free."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    if is_placeholder(path):
        # Tightened again only while empty: a 0555 directory with files in it
        # would stop `jht reset`.
        if info.st_mode & 0o222 and not os.listdir(path):
            os.chmod(path, 0o555)
        return "kept"
    os.unlink(path)  # a symlink goes, its target is never followed
    return "removed"


def sweep(
    ask: Callable[..., dict] = call,
    notify: Callable[[list[str]], None] = _default_notify,
) -> dict:
    answer = ask("mail.status", {}, role=RUNTIME_ROLE)
    if not answer.get("ok"):
        return {"ok": False, "reason": str(answer.get("reason", "broker_bad_answer")), "removed": [], "placeholders": []}
    migrated = answer.get("legacy_migrated")
    if not isinstance(migrated, dict):
        return {"ok": False, "reason": "broker_bad_answer", "removed": [], "placeholders": []}
    removed, placed, failed = [], [], []
    for name in NAMES:
        if migrated.get(name) is not True:
            continue
        try:
            # Missing after a reset or on a fresh home: the old clients create
            # it before writing, so the placeholder needs it too (and its
            # absence is not a failure to report every 30 s).
            os.makedirs(legacy_path(name).parent, mode=0o700, exist_ok=True)
        except OSError:
            failed.append(name)
            continue
        for suffix in PLACEHOLDER_SUFFIXES:
            path = Path(f"{legacy_path(name)}{suffix}")
            try:
                state = _clear(path)
                if state == "removed" and name not in removed:
                    removed.append(name)
                if state != "kept" and _place(path):
                    placed.append(path.name)
            except OSError:
                if name not in failed:
                    failed.append(name)
    if removed:
        try:
            notify(removed)
        except (OSError, subprocess.SubprocessError):
            pass  # the deletion is what matters; the notice is best effort
    result: dict = {"ok": not failed, "removed": removed, "placeholders": placed}
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
