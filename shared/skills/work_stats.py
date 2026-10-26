#!/usr/bin/env python3
"""work_stats — what the team did while it worked, as counts, kept on this computer.

The contract is banda/piani/CONTRATTO-orari-proiezioni-20261026.md (approved).  In short:

- ONE archive, `$JHT_HOME/stats/work-hours.jsonl` (folder 0700, file 0600): one row per UTC hour, with
  exactly these fields and no other: `hour`, `activeMinutes`, `scoreThreshold`, `weeklyDeltaPct`.
  Never a text, a title, a company, a name, a path.  Kept 90 days; `clear` removes it.
- `found` and `aboveThreshold` are NOT stored: they are counted from jobs.db when the page asks.
- The file lives where the team's agents can write, so a read trusts none of it: every row is checked
  (exact keys, types, ranges) and the ones that fail are dropped, and only so many bytes are read.
- Nothing here ever goes to the cloud.  The only writer is `record()`, called by the sentinel's bridge.

Uso:
  python3 work_stats.py read [--nights N]   JSON for the app's page
  python3 work_stats.py clear               remove the archive
  python3 work_stats.py record              one recording (the bridge calls record() itself)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

RETENTION_DAYS = 90
FILE_NAME = "work-hours.jsonl"
FIELDS = ("hour", "activeMinutes", "scoreThreshold", "weeklyDeltaPct")
MAX_FILE_BYTES = 2 * 1024 * 1024        # 90 days of hours is ~2200 rows of ~100 bytes: a larger file is not ours
MAX_LINE_BYTES = 512
MAX_ROWS = 24 * (RETENTION_DAYS + 2)
DEFAULT_NIGHTS = 30
_HOUR = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$")
_last_schedule_state: str | None = None


class StatsError(Exception):
    """A closed code of the team's (`stats_unreadable`, `stats_clear_failed`)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def stats_dir(home: Path | None = None) -> Path:
    return (home or jht_home()) / "stats"


def stats_file(home: Path | None = None) -> Path:
    return stats_dir(home) / FILE_NAME


def _int(value, low: int, high: int):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if low <= value <= high else None


def valid_row(row) -> dict | None:
    """The row as the archive defines it, or None.  Exact keys, types and ranges; nothing else passes."""
    if not isinstance(row, dict) or set(row) != set(FIELDS):
        return None
    hour = row["hour"]
    if not isinstance(hour, str) or not _HOUR.match(hour):
        return None
    try:
        datetime.strptime(hour, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    active = _int(row["activeMinutes"], 0, 60)
    threshold = _int(row["scoreThreshold"], 0, 100)
    delta = row["weeklyDeltaPct"]
    if active is None or threshold is None:
        return None
    if delta is not None and _int(delta, 0, 100) is None:
        return None
    return {"hour": hour, "activeMinutes": active, "scoreThreshold": threshold, "weeklyDeltaPct": delta}


def load_rows(home: Path | None = None) -> tuple[list[dict], bool]:
    """(the valid rows, whether anything in the file was dropped).  A file over the byte cap is not read."""
    path = stats_file(home)
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return [], False
    except OSError:
        raise StatsError("stats_unreadable")
    if size > MAX_FILE_BYTES:
        return [], True
    try:
        raw = path.read_bytes()
    except OSError:
        raise StatsError("stats_unreadable")
    rows: dict[str, dict] = {}
    dropped = False
    for line in raw.split(b"\n"):
        if not line.strip():
            continue
        if len(line) > MAX_LINE_BYTES or len(rows) >= MAX_ROWS:
            dropped = True
            continue
        try:
            row = valid_row(json.loads(line.decode("utf-8")))
        except Exception:
            row = None
        if row is None:
            dropped = True
            continue
        rows[row["hour"]] = row
    return sorted(rows.values(), key=lambda r: r["hour"]), dropped


def _write_rows(rows: list[dict], home: Path | None = None) -> None:
    directory = stats_dir(home)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    temporary = directory / f".{FILE_NAME}.{os.getpid()}.tmp"
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)     # 0600 from the first byte
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps({k: row[k] for k in FIELDS}, separators=(",", ":")) + "\n")
        os.replace(temporary, directory / FILE_NAME)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def score_threshold() -> int:
    """The score a position needs to be «above the threshold»: the team's own constant, not a setting."""
    import db_query
    return int(db_query.HARVEST_MIN_SCORE)


def weekly_delta(sentinel_path: Path, hour_start: datetime, now: datetime):
    """Whole points of the weekly budget used inside this hour, or None (no sample, or a reset)."""
    try:
        size = sentinel_path.stat().st_size
        with open(sentinel_path, "rb") as handle:
            handle.seek(max(0, size - 262144))
            raw = handle.read().decode("utf-8", "replace")
    except OSError:
        return None
    before = None
    inside: list[float] = []
    for line in raw.splitlines():
        try:
            entry = json.loads(line)
            at = datetime.fromisoformat(str(entry["ts"]).replace("Z", "+00:00")).timestamp()
            used = entry["weekly_usage"]
        except Exception:
            continue
        if isinstance(used, bool) or not isinstance(used, (int, float)):
            continue
        if at < hour_start.timestamp():
            before = float(used)
        elif at <= now.timestamp():
            inside.append(float(used))
    if not inside:
        return None
    start = before if before is not None else inside[0]
    delta = inside[-1] - start
    if delta < 0:
        return None
    return min(100, int(round(delta)))


def active_minutes(hour_start: datetime, now: datetime, config: dict | None) -> int:
    """Minutes of this hour, up to now, that the team's hours say it works (whatever it did)."""
    import working_hours
    last = min(59, int((now - hour_start).total_seconds() // 60))
    return sum(1 for minute in range(last + 1)
               if working_hours.is_within_working_hours(hour_start + timedelta(minutes=minute), config))


def record(now: datetime | None = None, home: Path | None = None, config: dict | None = None,
           sentinel_path: Path | None = None, log=print) -> dict:
    """Write (or update) the row of the current hour and drop what is past the retention."""
    global _last_schedule_state
    import working_hours
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    state = working_hours.schedule_status() if config is None else "valid"
    if state != _last_schedule_state:
        _last_schedule_state = state
        if state == "unreadable":
            # the registry line says what the gate does with it, so nobody reads «stopped» in it
            log("[work_stats] schedule_unreadable state=always_on_fallback")
    try:
        rows, dropped = load_rows(home)
    except StatsError:
        rows, dropped = [], True
    if dropped:
        log("[work_stats] work_stats_reset")
    row = {
        "hour": hour_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "activeMinutes": active_minutes(hour_start, now, config),
        "scoreThreshold": score_threshold(),
        "weeklyDeltaPct": weekly_delta(sentinel_path or (jht_home() / "logs" / "sentinel-data.jsonl"), hour_start, now),
    }
    keep_after = (hour_start - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [r for r in rows if r["hour"] != row["hour"] and r["hour"] >= keep_after] + [row]
    _write_rows(sorted(rows, key=lambda r: r["hour"]), home)
    return row


def clear(home: Path | None = None) -> dict:
    try:
        stats_file(home).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        raise StatsError("stats_clear_failed")
    return {"cleared": True}


# ── read ────────────────────────────────────────────────────────────────────

def _night_of(local, windows) -> str:
    """The date a working hour belongs to: the date its window STARTED on (a 22:00-08:00 window of
    Monday is Monday's night, past midnight too).  Without such a window, the local calendar date."""
    import working_hours
    weekday = local.weekday()
    t = local.time()
    for w in windows:
        try:
            start = working_hours._parse_hhmm(str(w["start"]))
            end = working_hours._parse_hhmm(str(w["end"]))
            days = {working_hours._WEEKDAY_INDEX[d] for d in (w.get("days") or []) if d in working_hours._WEEKDAY_INDEX}
        except Exception:
            continue
        if start > end and t < end and ((weekday - 1) % 7) in days:
            return (local - timedelta(days=1)).date().isoformat()
    return local.date().isoformat()


def _positions_by_hour(home: Path | None, since: str):
    """{hour: [best score or None, …]} for positions found since `since`; None if there is no database."""
    path = (home or jht_home()) / "jobs.db"
    if not path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            rows = conn.execute(
                """SELECT strftime('%Y-%m-%dT%H:00:00Z', p.found_at), s.total_score
                   FROM positions p
                   LEFT JOIN (SELECT position_id, MAX(total_score) AS total_score
                              FROM scores GROUP BY position_id) s ON s.position_id = p.id
                   WHERE p.found_at IS NOT NULL AND strftime('%Y-%m-%dT%H:00:00Z', p.found_at) >= ?""",
                (since,)).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        raise StatsError("stats_unreadable")
    out: dict[str, list] = {}
    for hour, score in rows:
        if hour:
            out.setdefault(hour, []).append(score)
    return out


def read(nights: int = DEFAULT_NIGHTS, home: Path | None = None, now: datetime | None = None) -> dict:
    import working_hours
    from zoneinfo import ZoneInfo
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    rows, _dropped = load_rows(home)
    cfg = working_hours._load_config(working_hours._config_path()) if home is None else \
        working_hours._load_config((home / "jht.config.json"))
    wh = (cfg.get("team") or {}).get("working_hours") if isinstance(cfg, dict) else None
    wh = wh if isinstance(wh, dict) else {}
    windows = [w for w in (wh.get("windows") or []) if isinstance(w, dict)] if isinstance(wh.get("windows"), list) else []
    try:
        tz = ZoneInfo(str(wh.get("timezone") or "UTC").strip() or "UTC")
    except Exception:
        tz = timezone.utc
    status_path = working_hours._config_path() if home is None else (home / "jht.config.json")
    state = working_hours.schedule_status(status_path)
    since = rows[0]["hour"] if rows else "9999"
    by_hour = _positions_by_hour(home, since) if rows else None
    grouped: dict[str, dict] = {}
    for r in rows:
        if r["activeMinutes"] == 0:
            continue
        start = datetime.strptime(r["hour"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        date = _night_of(start.astimezone(tz), windows)
        g = grouped.setdefault(date, {"minutes": 0, "thresholds": [], "delta": None, "found": 0, "above": 0, "scored": False})
        g["minutes"] += r["activeMinutes"]
        g["thresholds"].append(r["scoreThreshold"])
        if r["weeklyDeltaPct"] is not None:
            g["delta"] = (g["delta"] or 0) + r["weeklyDeltaPct"]
        if by_hour is not None:
            for score in by_hour.get(r["hour"], []):
                g["found"] += 1
                if score is not None:
                    g["scored"] = True
                    if score >= r["scoreThreshold"]:
                        g["above"] += 1
    listed = []
    for date in sorted(grouped)[-max(1, nights):]:
        g = grouped[date]
        listed.append({
            "date": date,
            "hoursActive": round(g["minutes"] / 60, 2),
            "found": g["found"] if by_hour is not None else None,
            "aboveThreshold": g["above"] if by_hour is not None and g["scored"] else None,
            "scoreThreshold": max(g["thresholds"]),
            "consumptionPct": g["delta"],
            "turnMedianSec": None,      # no source in the team's data (contract §1)
        })
    return {
        "nights": listed,
        "from": listed[0]["date"] if listed else None,
        "to": listed[-1]["date"] if listed else None,
        "lastObservation": rows[-1]["hour"] if rows else None,
        "retentionDays": RETENTION_DAYS,
        "threshold": score_threshold(),
        "scheduleState": state,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="work_stats")
    sub = parser.add_subparsers(dest="command", required=True)
    reader = sub.add_parser("read")
    reader.add_argument("--nights", type=int, default=DEFAULT_NIGHTS)
    sub.add_parser("clear")
    sub.add_parser("record")
    args = parser.parse_args(argv)
    try:
        if args.command == "read":
            out = read(max(1, min(args.nights, RETENTION_DAYS)))
        elif args.command == "clear":
            out = clear()
        else:
            out = {"recorded": record()["hour"]}
    except StatsError as error:
        print(json.dumps({"error": error.code}))
        return 1
    print(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
