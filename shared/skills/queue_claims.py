#!/usr/bin/env python3
"""queue_claims.py - one position, one Analista (or one Scorer) at a time.

The anti-collision protocol asked each peer to stamp `last_checked` before working on a position
(agents/_manual/anti-collision.md): a soft lock that depends on the agent remembering to do it, and the
position stays `new` (or `checked`) until the unit ends. On the burst of 10/11 (3 Analisti, 24 positions)
every position was opened by at least two of them, and 10 were finished twice or three times: three Analisti
did the unique work of one, the `new` queue stayed at 17-25 and the Scorers waited on an empty queue.

The claim is now made by the queue itself. `db_query.py next-for-analista` / `next-for-scorer` skip the
positions another agent holds, take the first free one for the caller in the same call, and list the
rest behind it; the same caller asking again gets its own position back. A claim is a file, made with O_EXCL
(atomic: of two callers only one gets it), that lasts TTL_SEC and then frees the position again, so an agent
that died holding one blocks nothing for long. There is no schema and no sync: the claims live under
$JHT_HOME/queue-claims and mean something only inside the box. A caller with no agent name (the bridge, a test,
a person at a prompt) neither takes nor is refused anything: the queue is listed as it always was.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Optional

TTL_SEC = 600
ROLES = ("analista", "scorer")
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def agent_name() -> Optional[str]:
    """Who is asking: JHT_AGENT_NAME or JHT_AGENT_ID, lower case; None when it is not an agent."""
    name = (os.environ.get("JHT_AGENT_NAME") or os.environ.get("JHT_AGENT_ID") or "").strip().lower()
    return name if _NAME_RE.match(name) else None


def _dir() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home") / "queue-claims"


def _path(role: str, position_id: int) -> Path:
    return _dir() / f"{role}-{int(position_id)}"


def _read(path: Path) -> Optional[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _fresh(entry: Optional[dict], now: float, ttl: float) -> bool:
    try:
        return entry is not None and now - float(entry["at"]) < ttl
    except (KeyError, TypeError, ValueError):
        return False


def holder(role: str, position_id: int, now: Optional[float] = None, ttl: float = TTL_SEC) -> Optional[str]:
    """The agent that holds this position now, or None (no claim, or one that is over)."""
    now = time.time() if now is None else now
    entry = _read(_path(role, position_id))
    return str(entry.get("agent")) if _fresh(entry, now, ttl) else None


def claim(role: str, position_id: int, agent: str, now: Optional[float] = None, ttl: float = TTL_SEC) -> bool:
    """Take this position for `agent`. False when another agent holds it. Never raises: a directory that cannot be
    written means no claim, and the caller goes on as it always did (the soft lock of the protocol)."""
    now = time.time() if now is None else now
    try:
        directory = _dir()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = _path(role, position_id)
        body = json.dumps({"agent": agent, "at": now}).encode("utf-8")
        for _ in range(3):
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                entry = _read(path)
                if _fresh(entry, now, ttl) and entry.get("agent") != agent:
                    return False
                # the same agent again, or a claim that is over: it is taken away by a rename (atomic: of two
                # callers that see the same old claim only one moves it) and the O_EXCL create is tried again
                try:
                    os.rename(path, f"{path}.{os.getpid()}.{int(now * 1000)}.old")
                except FileNotFoundError:
                    pass
                except OSError:
                    return True
                continue
            try:
                os.write(fd, body)
            finally:
                os.close(fd)
            _sweep(directory, now, ttl)
            return True
        return False
    except OSError:
        return True


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
        if not name.startswith(prefix) or not name[len(prefix):].isdigit():
            continue
        data = _read(entry)
        if _fresh(data, now, ttl) and data.get("agent") != agent:
            taken.add(int(name[len(prefix):]))
    return taken
