"""One process owns an application's browser until it explicitly releases it."""
from __future__ import annotations

import contextlib
import os
from pathlib import Path
import threading


class SessionBusy(Exception):
    pass


_owned: dict[tuple[int, int, str], tuple[object, int]] = {}


@contextlib.contextmanager
def position_lock(home: Path, position_id: int, *, owner=None):
    path = home / ".cache" / "apply-flow" / "locks" / f"{int(position_id)}.lock"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = (os.getpid(), threading.get_ident(), str(path.resolve()))
    if key in _owned:
        held_owner, count = _owned[key]
        if owner is None or held_owner is not owner:
            raise SessionBusy()
        _owned[key] = (owner, count + 1)
        try:
            yield
        finally:
            held_owner, count = _owned[key]
            _owned[key] = (held_owner, count - 1)
        return
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    locked = False
    try:
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"0")
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise SessionBusy() from exc
        locked = True
        _owned[key] = (owner, 1)
        yield
    finally:
        _owned.pop(key, None)
        if locked:
            if os.name == "nt":
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
