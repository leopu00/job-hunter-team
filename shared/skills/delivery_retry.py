"""Bounded delivery attempts; a reservation is not proof of delivery."""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import tempfile
import stat
from pathlib import Path

MAX_ATTEMPTS = 3
BACKOFF_S = 60


def retry_delay(attempt_number):
    return BACKOFF_S * 2 ** (attempt_number - 1)


def attempt(state, key, sender, now):
    """Keep failed attempts separate from the caller's successful-delivery state."""
    row = state.setdefault(key, {"attempts": 0, "next_at": 0})
    if row["attempts"] >= MAX_ATTEMPTS or now < row["next_at"]:
        return False
    row["attempts"] += 1
    row["next_at"] = now + retry_delay(row["attempts"])
    if sender():
        state.pop(key, None)
        return True
    return False


class WakeBudget:
    """Team state survives a bridge restart; concurrent bridges share one budget."""

    def __init__(self, home, filename="closer-wake-retries.json"):
        self.path = Path(home) / "state" / filename

    @contextlib.contextmanager
    def _locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.path.with_suffix(".lock"), flags, 0o600)
        with os.fdopen(fd, "a+b") as lock:
            if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
                raise ValueError("invalid wake retry lock")
            if os.name == "nt":
                import msvcrt

                lock.seek(0)
                if not lock.read(1):
                    lock.write(b"\0")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "nt":
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _read(self):
        fd = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024 * 1024:
                raise ValueError("invalid wake retry state file")
            return json.load(stream)

    def reserve(self, key, now, idle_reset_after=None):
        """Persist before sending. Invalid/unwritable state must not reset the cap."""
        digest = hashlib.sha256(key.encode()).hexdigest()
        with self._locked():
            try:
                state = self._read()
            except FileNotFoundError:
                state = {}
            if not isinstance(state, dict):
                raise ValueError("invalid wake retry state")
            row = state.get(digest, {"attempts": 0, "next_at": 0})
            if not isinstance(row, dict):
                raise ValueError("invalid wake retry entry")
            count, next_at = row["attempts"], row["next_at"]
            if (
                type(count) is not int
                or not 0 <= count <= MAX_ATTEMPTS
                or type(next_at) not in (int, float)
                or not math.isfinite(next_at)
            ):
                raise ValueError("invalid wake retry entry")
            if idle_reset_after is not None:
                last_seen = row.get("last_seen", next_at)
                if type(last_seen) not in (int, float) or not math.isfinite(last_seen):
                    raise ValueError("invalid retry episode")
                if now - last_seen >= idle_reset_after:
                    count, next_at = 0, 0
                row["last_seen"] = now
            allowed = count < MAX_ATTEMPTS and now >= next_at
            if allowed:
                row.update(attempts=count + 1, next_at=now + retry_delay(count + 1))
            elif idle_reset_after is None:
                return False
            state[digest] = row
            atomic_text(self.path, json.dumps(state))
            return allowed

    def exhausted(self, key):
        digest = hashlib.sha256(key.encode()).hexdigest()
        with self._locked():
            state = self._read()
            return state[digest]["attempts"] >= MAX_ATTEMPTS


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".delivery-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
