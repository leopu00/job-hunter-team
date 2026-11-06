#!/usr/bin/env python3
"""scout_yield.py — what the Scouts' night is WORTH: positions with a score of 70 or more, not positions found.

A night that finds a hundred positions of which three score 70 is not a good night, and a night that finds twelve of which nine
do is. «Found» is what the pass log and the DB count the moment a position is inserted; the user sees positions WITH a score. This
is the measure the Capitano reports, the diary writes and the exhaustion tool reads (JHT-T187):

  good      found by a Scout since the start of the window, scored, total_score >= the bar (70, `JHT_SCOUT_GOOD_SCORE`)
  pending   found, not scored yet (the Analista / Scorer have not got to it): it may still become a good one
  below     found and scored under the bar
  found     the three together (excluded positions with no score are not counted)

  python3 scout_yield.py [--since-hours H] [--min-score N] [--json]

The window is the working window of the team (working_hours.py) when there is one, otherwise the last 12 hours; `--since-hours`
says it. The database is opened READ ONLY (`mode=ro`): nothing is written, and a database that cannot be read answers
`{"ok": false}` and exit 1, never a made-up zero. The output is numbers and closed words only: no title, company or URL.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

DEFAULT_BAR = 70
DEFAULT_LOOKBACK_H = 12.0


def bar() -> int:
    try:
        value = int(os.environ.get("JHT_SCOUT_GOOD_SCORE", ""))
        return value if 1 <= value <= 100 else DEFAULT_BAR
    except ValueError:
        return DEFAULT_BAR


def db_path() -> Path:
    explicit = os.environ.get("JHT_DB")
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "jobs.db"


def window_start(now: float) -> float:
    """Start of the working window that holds `now`; the last 12 hours when there is none."""
    try:
        import working_hours  # noqa: PLC0415 — the skills folder, put on the path above
        bounds = working_hours.current_window_bounds(datetime.fromtimestamp(now, tz=timezone.utc))
        if bounds:
            return bounds[0].timestamp()
    except Exception:  # noqa: BLE001 — a configuration that cannot be read is no window
        pass
    return now - DEFAULT_LOOKBACK_H * 3600


def _stamp(ts: float) -> str:
    """SQLite's CURRENT_TIMESTAMP is UTC without a zone: the same shape, so the comparison is a string one."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def read(since_ts: float, min_score: int | None = None, path: Path | None = None) -> dict | None:
    """{good, pending, below, found, min_score, since} for the positions the Scouts found since `since_ts`, or None when the
    database cannot be read (no file, no table, locked): the caller falls back to what it had, it never invents a zero."""
    min_score = bar() if min_score is None else min_score
    path = path or db_path()
    try:
        con = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=2.0)
    except (sqlite3.Error, OSError, ValueError):
        return None
    try:
        rows = con.execute(
            "SELECT s.total_score, p.status FROM positions p LEFT JOIN scores s ON s.position_id = p.id "
            "WHERE p.found_at >= ? AND lower(COALESCE(p.found_by, '')) LIKE 'scout%'", (_stamp(since_ts),)).fetchall()
    except sqlite3.Error:
        return None
    finally:
        con.close()
    good = below = pending = 0
    for score, status in rows:
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            good += 1 if score >= min_score else 0
            below += 0 if score >= min_score else 1
        elif status != "excluded":
            pending += 1
    return {"good": good, "pending": pending, "below": below, "found": good + pending + below,
            "min_score": min_score, "since": datetime.fromtimestamp(since_ts, tz=timezone.utc).isoformat(timespec="seconds")}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since-hours", type=float, default=None)
    ap.add_argument("--min-score", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    now = time.time()
    since = now - args.since_hours * 3600.0 if args.since_hours and args.since_hours > 0 else window_start(now)
    result = read(since, args.min_score)
    if result is None:
        print(json.dumps({"ok": False, "error": "database_unreadable"}))
        return 1
    if args.json:
        print(json.dumps({"ok": True, **result}, sort_keys=True))
    else:
        print("good (>= %d): %d · pending (not scored yet): %d · below: %d · found: %d · since %s" % (
            result["min_score"], result["good"], result["pending"], result["below"], result["found"], result["since"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
