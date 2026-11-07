"""Private, bounded state and fixed diagnostics for managed Codex dialogs."""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import sys
import time

from delivery_retry import atomic_text

CATALOG = {
    "codex_dialog_pending": "The model reminder was detected; bounded recovery is pending.",
    "codex_dialog_recovered": "The model reminder was dismissed; the current model and session were kept.",
    "codex_dialog_ready": "The same pane now has a composer or work in progress; no automatic recovery is claimed.",
    "codex_dialog_timeout": "The model reminder did not close in time; manual diagnosis is required.",
    "codex_dialog_changed": "The live dialog changed; no further keys were sent.",
    "codex_dialog_unrecognized": "An unsupported Codex dialog needs manual diagnosis; no keys were sent.",
    "codex_dialog_io_error": "The dialog could not be checked or saved; recovery is unconfirmed.",
    "codex_dialog_notice_failed": "The dialog status could not be delivered to the coordinator.",
}


def report(home, code):
    line = json.dumps({"at": time.time(), "code": code, "message": CATALOG[code]})
    print(line, file=sys.stderr)
    path = Path(home) / "logs" / "runtime.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        with os.fdopen(fd, "a") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("invalid runtime log")
            stream.write(line + "\n")
    except (OSError, ValueError):
        print("codex_dialog_io_error: " + CATALOG["codex_dialog_io_error"], file=sys.stderr)
        return False
    return True


class DialogState:
    def __init__(self, home, session, pane):
        self.home = Path(home)
        digest = hashlib.sha256(f"{session}:{pane}".encode()).hexdigest()
        self.path = self.home / "state" / "codex-dialogs" / (digest + ".json")

    @contextlib.contextmanager
    def locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path.with_suffix(".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "a+b") as stream:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError("invalid dialog lock")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                yield None
                return
            yield self.read()

    def read(self):
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return {}
        with os.fdopen(fd, "r") as stream:
            meta = os.fstat(stream.fileno())
            if not stat.S_ISREG(meta.st_mode) or meta.st_size > 8192:
                raise ValueError("invalid dialog state")
            data = json.load(stream)
        if not isinstance(data, dict) or set(data) - {"pane", "attempted", "code", "notices", "at"}:
            raise ValueError("invalid dialog state")
        if (not isinstance(data.get("pane"), str) or len(data["pane"]) > 80
                or type(data.get("attempted")) is not bool
                or data.get("code") not in CATALOG
                or type(data.get("at")) not in (float, int) or not math.isfinite(data["at"])
                or type(data.get("notices")) is not int or not 0 <= data["notices"] <= 3):
            raise ValueError("invalid dialog state")
        return data

    def save(self, state):
        state["at"] = time.time()
        atomic_text(self.path, json.dumps(state))

    def publish(self, state, code, session, notify):
        if state.get("code") != code or state.get("notices") == 0:
            state.update(code=code, notices=0)
            if not report(self.home, code):
                raise OSError("dialog diagnostic unavailable")
        self.save(state)
        if state["notices"] < 3:
            state["notices"] += 1
            self.save(state)
            text = (f"[CODEX-DIALOG] {session}: {code}. {CATALOG[code]} "
                    "This is a CLI dialog state, not a dead worker. Do not replace it silently; "
                    "report the state before any manual recovery or replacement.")
            if notify(text):
                state["notices"] = 3
            else:
                report(self.home, "codex_dialog_notice_failed")
            self.save(state)
