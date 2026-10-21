"""The list of an existing team's positions carries the scam signals (JHT-T06), and filters on them.

`POSITIONS_READ_PY` (desktop/src-tauri/src/existing_team_runtime.rs) is the reader the app sends over
SSH with every read. A position gets `scam_signals` only from the codes it knows (the bucket is
recomputed here, not trusted), a garbled value or an older jobs.db gives None, and the filter `scam`
hides ("hide") or shows ("only") the positions of the «suspicious» section. Nothing is excluded or
deleted. The reader is taken from the Rust source as it is, pointed at a synthetic jobs.db.
"""

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs").read_text(encoding="utf-8")


def reader() -> str:
    start = SOURCE.index('r#"', SOURCE.index("const POSITIONS_READ_PY")) + len('r#"')
    return SOURCE[start : SOURCE.index('"#;', start)]


def ask(db: Path, filters=None) -> dict:
    script = reader().replace("file:/jht_home/jobs.db?mode=ro", f"file:{db}?mode=ro")
    request = {"op": "list"} if filters is None else {"op": "list", "filters": filters}
    done = subprocess.run([sys.executable, "-I", "-c", script], input=json.dumps(request) + "\n",
                          capture_output=True, text=True, timeout=30)
    return json.loads(done.stdout)


def items(db: Path, filters=None) -> dict:
    reply = ask(db, filters)
    assert reply["ok"] is True, reply
    return {item["id"]: item for item in reply["data"]["items"]}


def jobs_db(path: Path, with_column: bool = True, rows=()) -> Path:
    db = sqlite3.connect(path)
    extra = ", scam_signals TEXT" if with_column else ""
    db.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,"
               f" found_at TEXT, loc_country TEXT, loc_city TEXT, remote_type TEXT{extra})")
    marks = 9 if with_column else 8
    db.executemany(f"INSERT INTO positions VALUES ({','.join('?' * marks)})", rows)
    db.commit()
    db.close()
    return path


def row(pid, signals=None, status="scored"):
    return (pid, f"Synthetic role {pid}", f"Synthetic company {pid}", status, f"2026-10-0{pid}", "Italy",
            "Milan", "onsite", signals)


BADGE = json.dumps({"v": 1, "codes": ["advance_payment"], "bucket": "badge"})
SECTION = json.dumps({"v": 1, "codes": ["advance_payment", "private_chat_only"], "bucket": "section"})


@pytest.fixture()
def db(tmp_path):
    return jobs_db(tmp_path / "jobs.db", rows=[row(1), row(2, BADGE), row(3, SECTION, "new")])


def test_the_list_carries_the_signals_with_the_bucket_recomputed(db):
    found = items(db)
    assert found["1"]["scam_signals"] is None
    assert found["2"]["scam_signals"] == {"codes": ["advance_payment"], "bucket": "badge"}
    assert found["3"]["scam_signals"] == {"codes": ["advance_payment", "private_chat_only"], "bucket": "section"}


def test_only_the_known_codes_survive_and_a_stored_bucket_is_not_trusted(tmp_path):
    lying = json.dumps({"v": 1, "codes": ["advance_payment", "made_up_code"], "bucket": "section"})
    garbled = "not json {"
    unknown_only = json.dumps({"v": 1, "codes": ["made_up_code"], "bucket": "badge"})
    db = jobs_db(tmp_path / "jobs.db", rows=[row(1, lying), row(2, garbled), row(3, unknown_only)])
    found = items(db)
    assert found["1"]["scam_signals"] == {"codes": ["advance_payment"], "bucket": "badge"}
    assert found["2"]["scam_signals"] is None
    assert found["3"]["scam_signals"] is None


def test_an_older_jobs_db_without_the_column_still_reads(tmp_path):
    db = jobs_db(tmp_path / "jobs.db", with_column=False, rows=[(1, "Synthetic role 1", "Synthetic company 1",
                                                                  "scored", "2026-10-01", "Italy", "Milan", "onsite")])
    assert items(db)["1"]["scam_signals"] is None


def test_hide_keeps_the_section_out_of_the_list_and_only_shows_just_the_section(db):
    assert set(items(db, {"scam": "hide"})) == {"1", "2"}
    assert set(items(db, {"scam": "only"})) == {"3"}
    assert set(items(db)) == {"1", "2", "3"}


def test_the_reply_counts_the_section_whichever_view_is_asked(db):
    for view in (None, {"scam": "hide"}, {"scam": "only"}, {"scam": "only", "limit": 1, "offset": 0}):
        assert ask(db, view)["data"]["scamSection"] == 1, view
    # the count follows the other filters: the section's position is not "scored"
    assert ask(db, {"statuses": ["scored"]})["data"]["scamSection"] == 0
    assert ask(db, {"statuses": ["new"]})["data"]["scamSection"] == 1


def test_nothing_is_excluded_or_changed_by_the_filter(db):
    items(db, {"scam": "only"})
    rows = sqlite3.connect(db).execute("SELECT id, status FROM positions ORDER BY id").fetchall()
    assert rows == [(1, "scored"), (2, "scored"), (3, "new")]


@pytest.mark.parametrize("value", ["all", "", 1, True, ["only"]])
def test_an_unknown_scam_filter_is_a_bad_request(db, value):
    reply = ask(db, {"scam": value})
    assert reply["ok"] is False and reply["error"] == "positions_request_invalid"
