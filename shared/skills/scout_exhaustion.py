#!/usr/bin/env python3
"""scout_exhaustion.py — when the sources are DRY, measured, and how long the team stays quiet afterwards.

Until now «exhausted» was a sentence. A Scout wrote `[SCOUT-ESAUSTO]` after one pass of a few minutes on one or two
sources, the Captain took it at its word, and the team stood still for hours with the budget untouched (a live team,
night of 31/10: every Scout declared itself dry after ONE bounded pass). This tool makes it a measure and makes the
quiet short and growing.

WHAT «EXHAUSTED» MEANS (all of it, over the current working window, every Scout together):
  - at least N different sources: distinct (source, country) pairs in the pass log;         default 5
  - at least M different queries: distinct query hashes;                                      default 10
  - at least T minutes of searching: from the first to the last pass line;                    default 15
  - the CORE portals of the coverage plan are covered (scout_coverage.py: the national portals of each language the
    profile speaks, each asked with 3 passes and 3 different queries, or closed and declared so). Three numbers can be
    reached on five LinkedIn pages; this one cannot: it says WHERE the Scout still has to go (`missing` names the portal);
  - and NO candidate inserted: not one `inserted` outcome in the window.
The coverage clause never makes «exhausted» impossible: if the profile cannot be read, the table has none of its
languages, or scout_coverage.py is missing or fails, it does not block (the three numbers above stand alone).
Sources, queries and time count over the whole window (a second round does not have to repeat the first one); the
«no candidate inserted» and «at least one search» count since the last exhaustion accepted in the window, so that a Scout
woken after a quiet needs ONE new pass to confirm the sources are still dry, and a position found by it ends the quiet
ladder (the sources give again). If any of the first three is short, the answer says which and by how much (`missing`): the Scout goes on searching
exactly there. With no pass line at all the answer is `unmeasured`, which is NOT exhausted: the Scout has to log its
searches (skill scout-pass-log) before it can ever call the sources dry.

THE QUIET AFTER IT is a ladder, not a number of hours: 30 minutes, then 1 hour, 2 hours, 4 hours at most, one step for each
exhaustion accepted in the same working window. A new working window starts again from 30 minutes; so does `reset` (a
signal from the user, new sources in the profile). When the quiet ends nothing has to be remembered: `status` says
`quiet: false` and the heartbeat orders the next Scout.

  python3 scout_exhaustion.py check [--since-hours H] [--json]
        the verdict: exhausted | not_exhausted | unmeasured, the numbers and what is missing. Exit 0 exhausted,
        1 not exhausted, 2 unmeasured.
  python3 scout_exhaustion.py declare
        the Captain's call when a Scout reports [SCOUT-ESAUSTO]: it runs `check`, refuses (exit 3, with `missing`) when
        the sources are not dry, and otherwise writes the quiet and prints when it ends.
  python3 scout_exhaustion.py status
        quiet or not, how many exhaustions in this window, when the quiet ends. Exit 0 quiet, 1 not quiet.
  python3 scout_exhaustion.py reset [--reason user|new-sources|other]
        the quiet ends now.

Reads `$JHT_HOME/logs/scout-passes.jsonl` (written by scout_pass_log.py: lines `{"kind":"pass"|"candidate", "ts", "source",
"country", "query_hash", "outcome", ...}`) and keeps `$JHT_HOME/state/scout-quiescence.json`. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

MIN_SOURCES = 5
MIN_QUERIES = 10
MIN_SPAN_MIN = 15.0
LADDER_MIN = (30, 60, 120, 240)
DEFAULT_LOOKBACK_H = 12.0
RESET_REASONS = ("user", "new-sources", "other")


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def thresholds() -> dict:
    try:
        span = float(os.environ.get("JHT_SCOUT_EXHAUST_MIN_SPAN_MIN", ""))
        span = span if span > 0 else MIN_SPAN_MIN
    except ValueError:
        span = MIN_SPAN_MIN
    return {
        "sources": _int_env("JHT_SCOUT_EXHAUST_MIN_SOURCES", MIN_SOURCES),
        "queries": _int_env("JHT_SCOUT_EXHAUST_MIN_QUERIES", MIN_QUERIES),
        "span_min": span,
    }


def ladder() -> tuple:
    raw = os.environ.get("JHT_SCOUT_QUIESCENCE_LADDER_MIN", "")
    try:
        steps = tuple(int(part) for part in raw.split(",") if part.strip())
    except ValueError:
        steps = ()
    return steps if steps and all(step > 0 for step in steps) else LADDER_MIN


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def log_path() -> Path:
    return home() / "logs" / "scout-passes.jsonl"


def state_path() -> Path:
    return home() / "state" / "scout-quiescence.json"


def window_start(now: float) -> float | None:
    """Epoch of the start of the working window that holds `now`, or None (no window configured, or outside it)."""
    try:
        import working_hours  # noqa: PLC0415 — the skills folder, put on the path above
        bounds = working_hours.current_window_bounds(datetime.fromtimestamp(now, tz=timezone.utc))
    except Exception:  # noqa: BLE001 — a configuration that cannot be read is no window
        return None
    return bounds[0].timestamp() if bounds else None


def read_rows(since_ts: float, path: Path | None = None) -> list:
    rows = []
    for candidate in ((path or log_path()).with_suffix(".jsonl.1"), path or log_path()):
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            ts = row.get("ts") if isinstance(row, dict) else None
            if isinstance(ts, (int, float)) and not isinstance(ts, bool) and ts >= since_ts \
                    and row.get("kind") in ("pass", "candidate"):
                rows.append(row)
    rows.sort(key=lambda r: r["ts"])
    return rows


def measure(rows: list, since_declared: float | None = None) -> dict:
    """The numbers of a window. `inserted` and `passes_since` count since `since_declared` (the last accepted exhaustion
    of this window) when there is one, otherwise over the whole window."""
    sources = {(r.get("source"), r.get("country")) for r in rows if r["kind"] == "pass" and r.get("source")}
    queries = {r["query_hash"] for r in rows if r["kind"] == "pass" and isinstance(r.get("query_hash"), str)}
    passes = [r for r in rows if r["kind"] == "pass"]
    recent = [r for r in rows if since_declared is None or r["ts"] > since_declared]
    inserted = sum(1 for r in recent if r["kind"] == "candidate" and r.get("outcome") == "inserted")
    returned = sum(r["returned"] for r in passes if isinstance(r.get("returned"), int))
    stamps = [r["ts"] for r in rows]
    span = (max(stamps) - min(stamps)) / 60.0 if stamps else 0.0
    return {"passes": len(passes), "passes_since": sum(1 for r in recent if r["kind"] == "pass"),
            "sources": len(sources), "queries": len(queries), "returned": returned,
            "inserted": inserted, "span_min": round(span, 1)}


def core_missing(rows: list) -> list:
    """The core portals of the coverage plan still short of «covered», as «platsbanken/se 1/3» lines. Empty when they are all
    covered AND when it cannot tell (no scout_coverage.py, an unreadable profile, a language the table does not have, any
    error): the clause only ever adds a reason to keep searching that it can name, never one it cannot."""
    try:
        import scout_coverage  # noqa: PLC0415 — the skills folder, put on the path above
        missing = scout_coverage.core_missing(scout_coverage.portal_states(rows))
    except Exception:  # noqa: BLE001 — the measure of coverage never stops the other three
        return []
    return [m for m in missing if isinstance(m, str) and m] if isinstance(missing, (list, tuple)) else []


def verdict(numbers: dict, need: dict, after_declaration: bool = False, uncovered: list = None) -> dict:
    if numbers["passes"] == 0:
        return {"verdict": "unmeasured", "missing": ["no pass logged: log each search with scout_pass_log.py"]}
    missing = []
    if numbers["inserted"] > 0:
        missing.append("%d position(s) inserted since the last exhaustion: the sources still give" % numbers["inserted"])
    if after_declaration and numbers["passes_since"] == 0:
        missing.append("no new search since the last exhaustion: run at least one pass before declaring again")
    if numbers["sources"] < need["sources"]:
        missing.append("sources %d/%d (different source+country pairs)" % (numbers["sources"], need["sources"]))
    if numbers["queries"] < need["queries"]:
        missing.append("queries %d/%d (different queries)" % (numbers["queries"], need["queries"]))
    if numbers["span_min"] < need["span_min"]:
        missing.append("search time %.0f/%.0f min" % (numbers["span_min"], need["span_min"]))
    if uncovered:
        missing.append("core portals of the plan not covered yet (passes, different queries): %s; "
                       "ask `scout_coverage.py next`" % ", ".join(uncovered[:8]))
    return {"verdict": "not_exhausted" if missing else "exhausted", "missing": missing}


def _last_declaration(state: dict, start: float | None, now: float) -> float | None:
    """When the last exhaustion was accepted in THIS window, or None (none yet, or it belongs to an earlier window)."""
    declared = state.get("declared_at")
    if not isinstance(declared, (int, float)) or isinstance(declared, bool):
        return None
    if start is not None:
        return float(declared) if state.get("window_start") == start else None
    return float(declared) if now - float(declared) < DEFAULT_LOOKBACK_H * 3600 else None


def check(now: float | None = None, since_hours: float | None = None, path: Path | None = None) -> dict:
    now = time.time() if now is None else now
    start = window_start(now)
    since = now - since_hours * 3600 if since_hours is not None else (start if start is not None else now - DEFAULT_LOOKBACK_H * 3600)
    declared = _last_declaration(read_state(), start, now)
    rows = read_rows(since, path)
    numbers = measure(rows, declared)
    need = thresholds()
    uncovered = core_missing(rows) if rows else []
    return {**verdict(numbers, need, declared is not None, uncovered), **numbers, "need": need,
            "core_missing": uncovered,
            "window_start": datetime.fromtimestamp(since, tz=timezone.utc).isoformat(timespec="seconds")}


def read_state() -> dict:
    try:
        data = json.loads(state_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(data: dict) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def status(now: float | None = None) -> dict:
    now = time.time() if now is None else now
    state = read_state()
    wake = state.get("next_wake_at")
    if not isinstance(wake, (int, float)) or isinstance(wake, bool):
        return {"quiet": False, "consecutive": 0, "next_wake_at": None, "minutes_left": 0}
    quiet = now < wake
    return {"quiet": quiet, "consecutive": int(state.get("consecutive") or 0),
            "next_wake_at": datetime.fromtimestamp(wake, tz=timezone.utc).isoformat(timespec="seconds"),
            "minutes_left": max(0, round((wake - now) / 60.0)) if quiet else 0}


def declare(now: float | None = None, path: Path | None = None) -> tuple[int, dict]:
    now = time.time() if now is None else now
    result = check(now, path=path)
    if result["verdict"] != "exhausted":
        return 3, result
    start = window_start(now)
    state = read_state()
    last = _last_declaration(state, start, now)
    # The sources gave something since the last exhaustion → the ladder starts again; it cannot reach this point with an
    # insert (check refuses), so a ladder is only ever climbed by consecutive passes that found nothing.
    consecutive = (int(state.get("consecutive") or 0) if last is not None else 0) + 1
    steps = ladder()
    minutes = steps[min(consecutive, len(steps)) - 1]
    wake = now + minutes * 60
    write_state({"consecutive": consecutive, "declared_at": now, "next_wake_at": wake, "window_start": start,
                 "quiet_min": minutes})
    return 0, {**result, "accepted": True, "consecutive": consecutive, "quiet_min": minutes,
               "next_wake_at": datetime.fromtimestamp(wake, tz=timezone.utc).isoformat(timespec="seconds")}


def reset() -> None:
    try:
        state_path().unlink()
    except OSError:
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("check")
    p.add_argument("--since-hours", type=float, default=None)
    sub.add_parser("declare")
    sub.add_parser("status")
    p = sub.add_parser("reset")
    p.add_argument("--reason", choices=RESET_REASONS, default="other")
    args = ap.parse_args(argv)
    if args.cmd == "check":
        result = check(since_hours=args.since_hours)
        print(json.dumps(result, ensure_ascii=False))
        return {"exhausted": 0, "not_exhausted": 1}.get(result["verdict"], 2)
    if args.cmd == "declare":
        code, result = declare()
        print(json.dumps(result, ensure_ascii=False))
        return code
    if args.cmd == "status":
        result = status()
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["quiet"] else 1
    reset()
    print(json.dumps({"quiet": False, "reset": args.reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
