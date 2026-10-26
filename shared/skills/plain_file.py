#!/usr/bin/env python3
"""plain_file — the one way the team reads a file its agents can write.

The agents run as the same user as the readers that protect the budget and the actions, so a file they can
write may be replaced by a named pipe (the open waits for ever), a link (the reader reads another file) or a
huge file.  Nothing here raises for the reader to miss: a path that is not a plain file of ours is NotPlain.
"""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

JSON_MAX_BYTES = 1024 * 1024


class NotPlain(Exception):
    """What the path names is not a plain file of ours (a link, a pipe, a device, two names, too big)."""


def read_plain(path: Path, max_size: int | None = None, tail: int | None = None) -> bytes:
    """Read a file the team's agents can write, without letting it stall or redirect the reader.

    Opened without following a link and WITHOUT waiting (a named pipe in its place would otherwise hold the
    open for ever, and with it the sentinel's bridge that calls this), then checked on the descriptor it was
    opened as: a plain file with one name, within `max_size`.  At most `max_size` (or `tail`) bytes are read.
    FileNotFoundError passes; anything else that is not ours is NotPlain."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(str(path), flags)
    except FileNotFoundError:
        raise
    except OSError:
        raise NotPlain()
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise NotPlain()
        if max_size is not None and info.st_size > max_size:
            raise NotPlain()
        if tail is not None and info.st_size > tail:
            os.lseek(fd, info.st_size - tail, os.SEEK_SET)
        limit = max_size if max_size is not None else tail
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read((limit or 0) + 1) if max_size is not None else handle.read(limit)
    finally:
        os.close(fd)
    if max_size is not None and len(data) > max_size:
        raise NotPlain()
    return data


def read_json(path: Path, max_size: int = JSON_MAX_BYTES):
    """The JSON a plain file holds.  FileNotFoundError, NotPlain or ValueError, never a wait."""
    return json.loads(read_plain(path, max_size=max_size).decode("utf-8"))
