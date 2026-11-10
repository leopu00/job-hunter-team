#!/usr/bin/env python3
"""source_rate.py — one request cap and one pause PER SOURCE, shared by every Scout (not one per Scout).

Five Scouts asking the same portal at once look like one very fast client. The state lives in
`$JHT_HOME/state/source-rate.json`, read and written under a file lock, so all the Scouts (separate processes) see the
same numbers:

  * request cap  — at most `JHT_SOURCE_MAX_REQUESTS` requests (default 30) per `JHT_SOURCE_WINDOW_S` (default 600 s) to a
                   source, all Scouts together; past it the source is not asked until the oldest request leaves the window;
  * pause        — a 429, 403 or 503 from a source suspends it FOR EVERYONE: 5 minutes, then 10, 20, 40… (never more than
                   `JHT_SOURCE_COOLDOWN_MAX_S`, default 6 hours) while it keeps answering that way; the answer's
                   `Retry-After` wins when it is longer. A 200 ends the pause; six quiet hours reset the count.

A refused call makes NO request. Its answer is the same one LinkedIn gives (`linkedin_access.py`):
    {"rate_limited": true, "reason": "cooldown"|"request_cap"|"http_429"|"http_403"|"http_503",
     "retry_after_s": N, "retry_at": "<UTC>", "source": "<name>"}
and the Scout takes another source and comes back at `retry_at`. LinkedIn keeps its own state file (`linkedin-rate.json`)
and its own cap (40 per 10 minutes); this module is for every other source.

The sources are public pages and documented APIs only; this module never asks again to get round a refusal.

Command line (for a Scout that wants to look before it asks):
  python3 source_rate.py status [--source NAME]     # what is suspended and until when
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HIT_STATUSES = (403, 429, 503)
RETRY_AFTER_MAX_S = 86400.0
QUIET_RESET_S = 6 * 3600


def _env_number(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value == value and abs(value) != float("inf") and value > 0 else default


def _window_s() -> float:
    return _env_number("JHT_SOURCE_WINDOW_S", 600.0)


def _max_requests() -> int:
    return int(_env_number("JHT_SOURCE_MAX_REQUESTS", 30))


def _cooldown_base_s() -> float:
    return _env_number("JHT_SOURCE_COOLDOWN_BASE_S", 300.0)


def _cooldown_max_s() -> float:
    return _env_number("JHT_SOURCE_COOLDOWN_MAX_S", 21600.0)


def state_path() -> Path:
    """Resolved at use time: a test or a second team with another JHT_HOME must not share the import-time one."""
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "state" / "source-rate.json"


def normalize(source: str) -> str:
    name = str(source or "").strip().lower()
    return name[4:] if name.startswith("www.") else name


@contextlib.contextmanager
def _lock():
    """Exclusive lock on the shared state. Without fcntl (Windows) or when the lock cannot be taken: no lock."""
    try:
        import fcntl
    except ImportError:
        yield
        return
    handle = None
    try:
        path = state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(path.with_suffix(".lock"), "a+")
        fcntl.flock(handle, fcntl.LOCK_EX)
    except OSError:
        if handle is not None:
            handle.close()
        handle = None
    try:
        yield
    finally:
        if handle is not None:
            try:
                fcntl.flock(handle, fcntl.LOCK_UN)
            finally:
                handle.close()


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _clean_entry(raw, now: float) -> dict:
    """One source's numbers, each brought back to something sane (a state with absurd values must not stop a Scout)."""
    raw = raw if isinstance(raw, dict) else {}
    until = raw.get("cooldown_until")
    strikes = raw.get("strikes")
    last = raw.get("last_hit")
    reqs = raw.get("requests")
    return {
        "cooldown_until": until if _finite(until) and until <= now + _cooldown_max_s() + RETRY_AFTER_MAX_S else 0,
        "strikes": int(strikes) if _finite(strikes) and 0 <= strikes <= 1000 else 0,
        "last_hit": last if _finite(last) else 0,
        "requests": [t for t in reqs if _finite(t)] if isinstance(reqs, list) else [],
    }


def _read(now: float) -> dict:
    try:
        data = json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    sources = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(sources, dict):
        return {}
    return {str(k): _clean_entry(v, now) for k, v in sources.items()}


def _write(sources: dict, now: float) -> None:
    window = _window_s()
    keep = {}
    for name, entry in sources.items():
        entry = {**entry, "requests": [t for t in entry["requests"] if now - window < t <= now]}
        if entry["requests"] or entry["strikes"] or entry["cooldown_until"] > now:
            keep[name] = entry
    path = state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"sources": keep}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass   # a state that cannot be written is «no cap», never a failure of the search


def _limited(source: str, reason: str, retry_after_s: float, now: float) -> dict:
    retry_after = max(1, int(round(retry_after_s)))
    return {
        "rate_limited": True,
        "reason": reason,
        "retry_after_s": retry_after,
        "retry_at": datetime.fromtimestamp(now + retry_after, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
    }


def gate(source: str, now: float = None) -> dict | None:
    """None if a request to `source` may go out (and it is counted); else the rate_limited answer. No request is made."""
    name = normalize(source)
    if not name:
        return None
    now = time.time() if now is None else now
    with _lock():
        sources = _read(now)
        entry = sources.get(name) or _clean_entry({}, now)
        if entry["cooldown_until"] > now:
            return _limited(name, "cooldown", entry["cooldown_until"] - now, now)
        recent = [t for t in entry["requests"] if now - _window_s() < t <= now]
        if len(recent) >= _max_requests():
            return _limited(name, "request_cap", recent[0] + _window_s() - now, now)
        recent.append(now)
        sources[name] = {**entry, "requests": recent}
        _write(sources, now)
    return None


def note_hit(source: str, status: int = 429, retry_after: float = None, now: float = None) -> dict:
    """The source answered 429/403/503: it is suspended for every Scout, for longer each time it happens again."""
    name = normalize(source)
    now = time.time() if now is None else now
    with _lock():
        sources = _read(now)
        entry = sources.get(name) or _clean_entry({}, now)
        strikes = entry["strikes"] + 1 if now - entry["last_hit"] < QUIET_RESET_S else 1
        wait = min(_cooldown_max_s(), _cooldown_base_s() * 2 ** (strikes - 1))
        if _finite(retry_after) and retry_after > 0:
            wait = max(wait, min(float(retry_after), RETRY_AFTER_MAX_S))
        sources[name] = {**entry, "strikes": strikes, "last_hit": now, "cooldown_until": now + wait}
        _write(sources, now)
    return _limited(name, "http_%s" % status, wait, now)


def note_success(source: str, now: float = None) -> None:
    """A 200: the pause ends and the count starts again."""
    name = normalize(source)
    now = time.time() if now is None else now
    with _lock():
        sources = _read(now)
        entry = sources.get(name)
        if entry and (entry["strikes"] or entry["cooldown_until"]):
            sources[name] = {**entry, "strikes": 0, "cooldown_until": 0}
            _write(sources, now)


def status(source: str = None, now: float = None) -> dict:
    now = time.time() if now is None else now
    with _lock():
        sources = _read(now)
    wanted = normalize(source) if source else None
    out = {}
    for name, entry in sorted(sources.items()):
        if wanted and name != wanted:
            continue
        recent = [t for t in entry["requests"] if now - _window_s() < t <= now]
        row = {"requests_in_window": len(recent), "max_requests": _max_requests(), "strikes": entry["strikes"]}
        if entry["cooldown_until"] > now:
            row["suspended_until"] = datetime.fromtimestamp(entry["cooldown_until"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        out[name] = row
    return out


def retry_after_header(headers) -> float | None:
    """Seconds from a Retry-After header given as a number (a date is ignored: the pause rule is enough)."""
    try:
        value = float((headers or {}).get("Retry-After"))
    except (TypeError, ValueError, AttributeError):
        return None
    return min(value, RETRY_AFTER_MAX_S) if value == value and value > 0 else None


def guarded_fetch(source: str, fetch, url: str) -> tuple:
    """`fetch(url) -> (status, body)` with the shared rules around it.

    A refused call returns (429, b"") without asking, and prints the rate_limited answer on stderr so the Scout can read
    `retry_at`. A 403/429/503 starts or lengthens the pause; a 200 ends it."""
    blocked = gate(source)
    if blocked is not None:
        print(json.dumps(blocked), file=sys.stderr)
        return 429, b""
    code, body = fetch(url)
    if code in HIT_STATUSES:
        print(json.dumps(note_hit(source, code)), file=sys.stderr)
    elif code == 200:
        note_success(source)
    return code, body


def main(argv) -> int:
    import argparse
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status")
    s.add_argument("--source", default=None)
    args = p.parse_args(argv)
    print(json.dumps(status(args.source), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
