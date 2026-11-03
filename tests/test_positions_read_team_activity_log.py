"""The Activity log page of a profile with no cloud account (op `team_activity_log` of POSITIONS_READ_PY, desktop/src-tauri).

Every event of the team, newest first, each with the position it touched: the same five sources as the activity
counts, read from the team's jobs.db read only. A column the database lacks gives no events of that source, and the
reply is held to a byte budget by dropping the oldest events. Synthetic data only.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_positions_read_team_activity import _database, _run  # noqa: E402

LOG = {"op": "team_activity_log"}


def test_every_event_comes_newest_first_with_the_position_it_touched(tmp_path: Path) -> None:
    events = _database(tmp_path)
    reply = _run(tmp_path, LOG)
    assert reply["ok"] is True and set(reply["data"]) == {"items"}
    items = reply["data"]["items"]
    assert [item["ts"] for item in items] == sorted((e[2] for e in events), reverse=True)
    assert {(i["role"], i["actor"], i["ts"], i["pid"]) for i in items} == {(r, a, t, str(p)) for r, a, t, p in events}
    for item in items:
        n = int(item["pid"])
        assert (item["title"], item["company"], item["legacyId"]) == (f"Role {n}", f"Co {n % 4}", 1000 + n)
        assert set(item) == {"role", "actor", "ts", "pid", "title", "company", "legacyId"}


def test_a_database_without_the_columns_gives_the_events_it_has(tmp_path: Path) -> None:
    events = _database(tmp_path, full=False)
    items = _run(tmp_path, LOG)["data"]["items"]
    assert len(items) == len(events) == 30
    assert {item["role"] for item in items} == {"scout"} and {item["actor"] for item in items} == {None}


def test_a_team_that_has_not_run_yet_has_an_empty_log(tmp_path: Path) -> None:
    assert _run(tmp_path, LOG) == {"ok": True, "data": {"items": []}}


def test_the_log_is_read_only_and_never_selects_a_whole_row(tmp_path: Path) -> None:
    _database(tmp_path)
    before = (tmp_path / "jobs.db").read_bytes()
    statements: list[str] = []
    _run(tmp_path, LOG, statements)
    assert (tmp_path / "jobs.db").read_bytes() == before
    assert statements and not any(s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "CREATE", "DROP")) for s in statements)
    assert not any("SELECT *" in s or "jd_text" in s for s in statements)


def test_text_is_cut_and_a_huge_log_keeps_the_newest_events_inside_the_budget(tmp_path: Path) -> None:
    db = sqlite3.connect(tmp_path / "jobs.db")
    db.execute("CREATE TABLE positions(id INTEGER PRIMARY KEY, legacy_id INTEGER, title TEXT, company TEXT, found_at TEXT, found_by TEXT)")
    db.execute("CREATE TABLE scores(id INTEGER PRIMARY KEY, position_id INTEGER)")
    db.execute("CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER)")
    for n in range(6000):
        day, minute = 1 + n // 1440, n % 1440
        db.execute("INSERT INTO positions VALUES(?,?,?,?,?,?)", (n + 1, n, "T" * 5000 if n == 5999 else f"R{n}", "C" * 500, f"2026-10-{day:02d}T{minute // 60:02d}:{minute % 60:02d}:00Z", "scout-1"))
    db.commit()
    db.close()
    items = _run(tmp_path, LOG)["data"]["items"]
    assert len(items) == 5000
    assert items[0]["pid"] == "6000" and len(items[0]["title"]) == 200 and len(items[0]["company"]) == 120
    assert len(json.dumps({"items": items}, separators=(",", ":"))) <= 1363148


@pytest.mark.parametrize("extra", [{"from": "2026-10-01"}, {"to": "2026-10-02"}, {"offset": 1}, {"id": "1"}, {"limit": 3}])
def test_the_request_takes_no_argument(tmp_path: Path, extra: dict) -> None:
    _database(tmp_path)
    assert _run(tmp_path, {**LOG, **extra}) == {"ok": False, "error": "positions_request_invalid"}
