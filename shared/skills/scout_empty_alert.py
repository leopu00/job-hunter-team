#!/usr/bin/env python3
"""scout_empty_alert.py — a Scout that gets an empty answer three times from the same source and does not move on.

A Scout asks a source, gets nothing, and asks the same source again with another word: that is not searching, it is a loop,
and the night goes by. After THREE empty passes in a row from the same agent on the same source and country (`--returned 0`,
no error status: a 403 or a 429 is another problem and has its own words), this tool:

  1. writes one line to `$JHT_HOME/logs/scout-alerts.jsonl` (closed words and numbers: kind, agent, source, country, the number of
     passes, when the streak began). The Dottore reads it (`list`), so a Scout that loops is seen in his round;
  2. tells the user, in the user's language, through `jht-notify-user` (the app's panel, Telegram if linked): a fixed sentence from
     the catalog, `scout_empty_notice.streak`, in plain words: no source name, no number, nothing to do. AT MOST ONE message to the
     user every 24 hours IN TOTAL (`JHT_SCOUT_EMPTY_NOTIFY_H`), whatever the number of Scouts and sources: the other alerts stay in
     the file only (`notified: false`, `held: "cap"`), and the Doctor still reads them;
  3. prints one line to the Scout that logged the pass, saying where to go: `scout_coverage.py next`.

The fourth empty pass of the same streak is not a new alert; a pass that returned something, or a pass on another source,
ends the streak. `scout_pass_log.py pass` calls `check` after writing its line, so the Scouts do nothing more. The number of
passes is `JHT_SCOUT_EMPTY_ROUNDS` (3 by default, 2 to 10).

  python3 scout_empty_alert.py list [--since-hours H] [--json]     the alerts of the last 24 h and whether the Scout moved on

The file of alerts has a size cap (256 KiB): when it is passed the oldest lines are dropped down to half of it, the newest stay.

An error here is a warning on stderr and exit 0: the alert never stops the log it watches. Standard library only (the user's
language and the notify tool are taken from web_action_notice.py, and only when an alert is really raised).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

DEFAULT_ROUNDS = 3
# Passes of one streak are one sitting of the Scout: three empty passes spread over days are not a loop.
STREAK_SPAN_H = 6.0
# One message to the user in this many hours, in total: ten sources dry in a night are ten lines in the file and ONE message.
DEFAULT_NOTIFY_EVERY_H = 24.0
# The file of alerts never grows without end: past this size the oldest lines go, down to half of it.
ALERTS_MAX_BYTES = 256 * 1024
READ_TAIL_BYTES = 256 * 1024
KIND = "empty_streak"
SOURCE_ACTION = "scout_empty_alert"
AGENT = "dottore"
NOTICE_KEY = "scout_empty_notice.streak"
ID_PART = re.compile(r"[^A-Za-z0-9_.-]")


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def log_path() -> Path:
    return home() / "logs" / "scout-passes.jsonl"


def alerts_path() -> Path:
    return home() / "logs" / "scout-alerts.jsonl"


def rounds() -> int:
    try:
        value = int(os.environ.get("JHT_SCOUT_EMPTY_ROUNDS", ""))
        return value if 2 <= value <= 10 else DEFAULT_ROUNDS
    except ValueError:
        return DEFAULT_ROUNDS


def notify_every_h() -> float:
    try:
        value = float(os.environ.get("JHT_SCOUT_EMPTY_NOTIFY_H", ""))
        return value if 1.0 <= value <= 24.0 * 30 else DEFAULT_NOTIFY_EVERY_H
    except ValueError:
        return DEFAULT_NOTIFY_EVERY_H


def _tail_lines(path: Path) -> list:
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - READ_TAIL_BYTES))
            data = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return []
    lines = data.splitlines()
    return lines[1:] if size > READ_TAIL_BYTES and lines else lines


def _rows(path: Path) -> list:
    rows = []
    for line in _tail_lines(path):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and isinstance(row.get("ts"), (int, float)) and not isinstance(row.get("ts"), bool):
            rows.append(row)
    return rows


def is_empty(row: dict) -> bool:
    """A pass that ANSWERED and returned nothing. A closed, gone or blocked source answered with something else."""
    return (row.get("kind") == "pass" and row.get("returned") == 0 and not isinstance(row.get("returned"), bool)
            and row.get("status") in (None, "ok", "empty"))


def streak(rows: list, agent: str) -> list:
    """The trailing run of empty passes of `agent` on one source+country, newest last (empty when the last pass is not one)."""
    mine = sorted((r for r in rows if r.get("kind") == "pass" and r.get("agent") == agent), key=lambda r: r["ts"])
    if not mine or not is_empty(mine[-1]):
        return []
    last = mine[-1]
    run = []
    for row in reversed(mine):
        if not is_empty(row) or (row.get("source"), row.get("country")) != (last.get("source"), last.get("country")):
            break
        if last["ts"] - row["ts"] > STREAK_SPAN_H * 3600:
            break
        run.append(row)
    return list(reversed(run))


def _already_raised(source: str, country: str, agent: str, began: float, path: Path) -> bool:
    for row in _rows(path):
        if (row.get("kind") == KIND and row.get("agent") == agent and row.get("source") == source
                and row.get("country") == country and row.get("began") == began):
            return True
    return False


def _trim(path: Path) -> None:
    """Past the size cap, keep the newest half of the lines (whole lines only). Never raises: a trim that fails is a file a bit big."""
    try:
        if path.stat().st_size <= ALERTS_MAX_BYTES:
            return
        kept, size = [], 0
        for text in reversed(path.read_bytes().splitlines(keepends=True)):
            size += len(text)
            if size > ALERTS_MAX_BYTES // 2:
                break
            kept.insert(0, text)
        tmp = path.with_suffix(".jsonl.tmp")
        tmp.write_bytes(b"".join(kept))
        os.replace(tmp, path)
    except OSError:
        pass


def _append(row: dict, path: Path) -> bool:
    line = (json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        _trim(path)
        fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, line)
        finally:
            os.close(fd)
        return True
    except OSError:
        return False


def notify_user(key: str, lang: str | None = None, run=subprocess.run) -> bool:
    """The sentence of `scout_empty_notice.streak` in the user's language, once for `key`, through jht-notify-user."""
    try:
        import web_action_notice as shared  # noqa: PLC0415 — language, catalog and notify tool of the box
        tool = shared.notify_tool()
        if tool is None:
            return False
        text = shared._catalog(lang or shared.user_language())[NOTICE_KEY]
        cmd = [sys.executable, str(tool), "--agent", AGENT, "--kind", "alert",
               "--source-id", "scout-empty:" + key, "--source-action", SOURCE_ACTION,
               "--source-payload", json.dumps({"code": "streak"}, separators=(",", ":")), text]
        result = run(cmd, capture_output=True, text=True, timeout=60, env=os.environ.copy())
        return result.returncode == 0
    except Exception:  # noqa: BLE001 — telling the user never stops the log
        return False


def check(agent: str, now: float | None = None, log: Path | None = None, alerts: Path | None = None, run=subprocess.run) -> dict | None:
    """Raise the alert when `agent`'s trailing empty passes on one source reach the number; the alert line, or None."""
    now = time.time() if now is None else now
    run_of = streak(_rows(log or log_path()), agent)
    # exactly the number: the fourth empty pass of the same streak is not a second alert
    if len(run_of) != rounds():
        return None
    first, last = run_of[0], run_of[-1]
    source, country = str(last.get("source")), str(last.get("country"))
    began = first["ts"]
    path = alerts or alerts_path()
    if _already_raised(source, country, agent, began, path):
        return None
    key = ID_PART.sub("_", "%s:%s:%s:%s" % (agent, source, country, int(began)))[:150]
    with _locked(path):
        # one message to the user in 24 h in total: the other alerts are kept in the file and the Doctor reads them
        capped = _told_recently(path, now)
        row = {"v": 1, "kind": KIND, "ts": round(now, 3), "agent": agent, "source": source, "country": country,
               "passes": len(run_of), "began": began, "notified": False if capped else notify_user(key, run=run)}
        if capped:
            row["held"] = "cap"
        _append(row, path)
    return row


def _told_recently(path: Path, now: float) -> bool:
    """A message to the user was really delivered (`notified: true`) in the last window. A failed delivery does not use the turn."""
    window = notify_every_h() * 3600
    return any(r.get("kind") == KIND and r.get("notified") is True and 0 <= now - r["ts"] < window for r in _rows(path))


class _locked:
    """An exclusive lock on the file of alerts while the cap is checked and the message sent, so two Scouts finishing a streak at the
    same moment do not both write to the user. Where fcntl does not exist (Windows) there is no lock: the sentence is still one per streak."""
    def __init__(self, path: Path):
        self.path, self.fd = path.with_suffix(".lock"), None

    def __enter__(self):
        try:
            import fcntl  # noqa: PLC0415
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.fd = os.open(str(self.path), os.O_WRONLY | os.O_CREAT, 0o644)
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        except (ImportError, OSError):
            if self.fd is not None:
                os.close(self.fd)
            self.fd = None
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)   # closing the descriptor releases the lock
        return False


def recent(since_hours: float = 24.0, now: float | None = None, log: Path | None = None, alerts: Path | None = None) -> list:
    """The alerts of the last `since_hours`, each with `resolved`: the Scout got something, or asked another source, since."""
    now = time.time() if now is None else now
    passes = [r for r in _rows(log or log_path()) if r.get("kind") == "pass"]
    out = []
    for alert in _rows(alerts or alerts_path()):
        if alert.get("kind") != KIND or now - alert["ts"] > since_hours * 3600:
            continue
        later = [p for p in passes if p.get("agent") == alert.get("agent") and p["ts"] > alert["ts"]]
        moved = any((p.get("source"), p.get("country")) != (alert.get("source"), alert.get("country")) or
                    (isinstance(p.get("returned"), int) and p["returned"] > 0) for p in later)
        out.append({"agent": alert.get("agent"), "source": alert.get("source"), "country": alert.get("country"),
                    "passes": alert.get("passes"), "at": alert["ts"], "resolved": moved})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--since-hours", type=float, default=24.0)
    p.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    found = recent(args.since_hours)
    if args.json:
        print(json.dumps({"ok": True, "alerts": found}, sort_keys=True))
    elif not found:
        print("no empty-streak alert in the last %g h" % args.since_hours)
    for a in found:
        if not args.json:
            print("%s asked %s/%s %s times in a row and got nothing%s" % (
                a["agent"], a["source"], a["country"], a["passes"], " (moved on since)" if a["resolved"] else " (still there)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
