"""Delivery error codes and the team's runtime log, without message contents."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

CATALOG = {
    "message_not_delivered": "The message was not delivered; the action remains unconfirmed.",
    "wake_retry_state_unavailable": "The wake retry state cannot be read or saved; the wake remains pending.",
    "wake_retry_exhausted": "The wake was not delivered after three attempts; it remains pending for manual recovery.",
    "delivery_state_unavailable": "The delivery state cannot be read or saved; delivery is unconfirmed.",
}


def _reporter():
    """Which function asked for this line: «module.function» of the first frame outside this file. A name of the product's own code, never
    a value: the line then says where the undelivered message came from, which the code and the fixed sentence alone do not."""
    frame = sys._getframe(1)
    while frame is not None and frame.f_code.co_filename == __file__:
        frame = frame.f_back
    if frame is None:
        return None
    module = os.path.splitext(os.path.basename(frame.f_code.co_filename))[0]
    return f"{module}.{frame.f_code.co_name}"[:80]


def report(code, *, home=None, rc=None):
    row = {"at": datetime.now(timezone.utc).isoformat(), "code": code, "message": CATALOG[code]}
    if rc is not None:
        row["rc"] = rc
    source = _reporter()
    if source:
        row["from"] = source
    line = json.dumps(row, separators=(",", ":"))
    print(line, file=sys.stderr)
    path = Path(home or os.environ.get("JHT_HOME") or Path.home() / ".jht") / "logs" / "runtime.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as out:
            out.write(line + "\n")
    except OSError:
        print("delivery_state_unavailable: cannot append runtime.log", file=sys.stderr)


def checked(sender, *, home=None):
    try:
        delivered = bool(sender())
    except (OSError, subprocess.SubprocessError):
        delivered = False
    if not delivered:
        report("message_not_delivered", home=home)
    return delivered
