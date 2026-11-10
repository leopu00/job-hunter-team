#!/usr/bin/env python3
"""queue_claims.py - one position, one Analista (or one Scorer) at a time.

The anti-collision protocol asked each peer to stamp `last_checked` before working on a position
(agents/_manual/anti-collision.md): a soft lock that depends on the agent remembering to do it, and the
position stays `new` (or `checked`) until the unit ends. On the burst of 10/11 (3 Analisti, 24 positions)
every position was opened by at least two of them, and 10 were finished twice or three times: three Analisti
did the unique work of one, the `new` queue stayed at 17-25 and the Scorers waited on an empty queue.

The claim is now made by the queue itself. `db_query.py next-for-analista` / `next-for-scorer` skip the
positions another agent holds, take the first free one for the caller in the same call, and list the
rest behind it; the same caller asking again gets its own position back. A claim is a file, published with a hard link
(atomic: of two callers only one gets it, and it is never seen empty), that lasts TTL_SEC and then frees the position again, so an agent
that died holding one blocks nothing for long. There is no schema and no sync: the claims live under
$JHT_HOME/queue-claims and mean something only inside the box. A caller with no agent name (the bridge, a test,
a person at a prompt) neither takes nor is refused anything: the queue is listed as it always was.
"""
from __future__ import annotations

import json
import os
import re
import stat
import time
from pathlib import Path
from typing import Optional

TTL_SEC = 600
FUTURE_MARGIN_SEC = 60   # a claim stamped later than this from now is not believed (it would hold the position for ever)
MAX_CLAIM_BYTES = 4096   # a claim is a line of JSON; anything bigger is not one
ROLES = ("analista", "scorer")
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def agent_name() -> Optional[str]:
    """Who is asking: JHT_AGENT_NAME or JHT_AGENT_ID, lower case; None when it is not an agent."""
    name = (os.environ.get("JHT_AGENT_NAME") or os.environ.get("JHT_AGENT_ID") or "").strip().lower()
    return name if _NAME_RE.match(name) else None


def role_of(agent: Optional[str]) -> str:
    """The role of an agent name: `analista-2` is `analista` (the same rule as throttle_engine)."""
    return re.sub(r"-\d+$", "", str(agent or "").strip().lower())


def _dir() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home") / "queue-claims"


def _path(role: str, position_id: int) -> Path:
    return _dir() / f"{role}-{int(position_id)}"


def _read(path: Path) -> Optional[dict]:
    """The claim in this file, or None. Only a regular file of a few bytes is read, and without following a link and
    without waiting on a pipe: what sits where a claim should be is not always one (a FIFO or a huge file would hold
    every `next-for-*` of the box)."""
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_CLAIM_BYTES:
            return None
        data = json.loads(os.read(fd, MAX_CLAIM_BYTES + 1).decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


def _fresh(entry: Optional[dict], now: float, ttl: float) -> bool:
    try:
        age = now - float(entry["at"]) if entry is not None else None
    except (KeyError, TypeError, ValueError):
        return False
    # too old is over; stamped in the future by more than the margin is not believed either
    return age is not None and -FUTURE_MARGIN_SEC < age < ttl


def holder(role: str, position_id: int, now: Optional[float] = None, ttl: float = TTL_SEC) -> Optional[str]:
    """The agent that holds this position now, or None (no claim, or one that is over)."""
    now = time.time() if now is None else now
    entry = _read(_path(role, position_id))
    return str(entry.get("agent")) if _fresh(entry, now, ttl) else None


def _young(path: Path, now: float, ttl: float) -> bool:
    """A file that cannot be read as a claim but is younger than the TTL: somebody is making it, it is held."""
    try:
        return now - path.stat().st_mtime < ttl
    except OSError:
        return False


def claim(role: str, position_id: int, agent: str, now: Optional[float] = None, ttl: float = TTL_SEC) -> bool:
    """Take this position for `agent`. False when another agent holds it. Never raises: a directory that cannot be
    written means no claim, and the caller goes on as it always did (the soft lock of the protocol)."""
    now = time.time() if now is None else now
    tmp: Optional[Path] = None
    try:
        directory = _dir()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = _path(role, position_id)
        # The body is written whole in a file of its own and PUBLISHED with a hard link: link() is atomic and
        # fails when the claim is there, and the claim never exists empty or half written (an O_EXCL create
        # followed by a write leaves a window where another caller reads nothing and takes the position too).
        tmp = directory / f".tmp-{os.getpid()}-{time.monotonic_ns()}"
        fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(fd, json.dumps({"agent": agent, "at": now}).encode("utf-8"))
        finally:
            os.close(fd)
        for _ in range(3):
            try:
                os.link(tmp, path)
            except FileExistsError:
                entry = _read(path)
                if entry is None and _young(path, now, ttl):
                    return False
                if _fresh(entry, now, ttl):
                    if entry.get("agent") != agent:
                        return False
                    # the same agent again: the claim is renewed in place (atomic replace, never absent)
                    os.replace(tmp, path)
                    tmp = None
                    return True
                # a claim that is over: it is taken away by a rename (atomic: of two callers that see the same
                # old claim only one moves it) and the link is tried again
                moved = f"{path}.{os.getpid()}.{int(now * 1000)}.old"
                try:
                    os.rename(path, moved)
                except FileNotFoundError:
                    continue
                except OSError:
                    return True
                if _fresh(_read(Path(moved)), now, ttl):
                    # what was moved is a live claim that another caller made after this one looked: put it back
                    try:
                        os.link(moved, path)
                    except OSError:
                        pass
                    return False
                continue
            except OSError:
                # a disk that makes no hard links: the O_EXCL create (an empty file is read as held while it is young)
                try:
                    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                except FileExistsError:
                    continue
                try:
                    os.write(fd, json.dumps({"agent": agent, "at": now}).encode("utf-8"))
                finally:
                    os.close(fd)
            _sweep(directory, now, ttl)
            return True
        return False
    except OSError:
        return True
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def _sweep(directory: Path, now: float, ttl: float) -> None:
    """Take away what is over (old claims and the renamed ones), at most a few at a time. Best effort."""
    try:
        for index, entry in enumerate(directory.iterdir()):
            if index > 200:
                return
            try:
                if now - entry.stat().st_mtime > ttl * 3:
                    entry.unlink()
            except OSError:
                continue
    except OSError:
        return


def claimed_by_others(role: str, agent: str, now: Optional[float] = None, ttl: float = TTL_SEC) -> set[int]:
    """The ids of this role's positions another agent holds now."""
    now = time.time() if now is None else now
    taken: set[int] = set()
    try:
        names = list(_dir().iterdir())
    except OSError:
        return taken
    prefix = f"{role}-"
    for entry in names:
        name = entry.name
        if not name.startswith(prefix) or not re.fullmatch(r"[0-9]{1,18}", name[len(prefix):]):
            continue
        data = _read(entry)
        if _fresh(data, now, ttl) and data.get("agent") != agent:
            taken.add(int(name[len(prefix):]))
    return taken
