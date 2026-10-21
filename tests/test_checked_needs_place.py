"""JHT-T03 — a position cannot become `checked` without a place.

`db_update.py position <ID> --status checked` is refused (exit 1, LOCATION_MISSING, row untouched)
when the row, as the UPDATE would leave it, has no city, no country and no explicit remote regime.
The rule lives in the code, not in the prompts: a prompt can forget, the script cannot.

- it looks at the row AFTER the call: the place may be in the database already or come in the
  same command (the enrichment skill writes it in the command that promotes);
- it guards only the transition TO `checked`: touching a row that is already `checked` is not
  refused, and the old rows without a place are not rewritten;
- a fully remote position without a country passes (precision `remote`);
- the first precision level is written in the same UPDATE when the row has none, and a level
  that is already there is never lowered or touched;
- the prompts of every role, in the seven languages, write the place BEFORE they promote.
"""

from __future__ import annotations

import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402

DB_UPDATE = SKILLS / "db_update.py"
LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")


def _run(db: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(DB_UPDATE), *args],
        cwd=ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
    )


def _make(db: Path, **columns) -> int:
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    columns = {"title": "Engineer", "company": "Acme", "status": "new", **columns}
    cursor = conn.execute(
        f"INSERT INTO positions ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        list(columns.values()),
    )
    conn.commit()
    conn.close()
    return cursor.lastrowid


def _whole_row(db: Path, pid: int):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT * FROM positions WHERE id = ?", (pid,)).fetchone()
    finally:
        conn.close()


def _read(db: Path, pid: int, *columns: str):
    conn = sqlite3.connect(db)
    try:
        return conn.execute(f"SELECT {', '.join(columns)} FROM positions WHERE id = ?", (pid,)).fetchone()
    finally:
        conn.close()


def _transitions(db: Path) -> int:
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT COUNT(*) FROM position_state_transitions").fetchone()[0]
    finally:
        conn.close()


def _refused(db: Path, pid: int, *args: str) -> None:
    before = _whole_row(db, pid)
    done = _run(db, "position", str(pid), *args)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "LOCATION_MISSING" in done.stderr and "location_missing" in done.stderr
    assert _whole_row(db, pid) == before
    assert _transitions(db) == 0


@pytest.fixture
def db(tmp_path):
    return tmp_path / "jobs.db"


@pytest.mark.parametrize("columns", [{}, {"remote_type": "onsite"}, {"remote_type": "hybrid"}, {"work_mode": "hybrid"}])
def test_checked_without_a_place_is_refused_and_the_row_stays_as_it_was(db, columns):
    pid = _make(db, **columns)
    _refused(db, pid, "--status", "checked", "--notes", "looked at")


def test_the_same_goes_for_a_position_coming_back_from_another_state(db):
    pid = _make(db, status="excluded")
    _refused(db, pid, "--status", "checked")


def test_a_blank_city_and_country_are_no_place(db):
    pid = _make(db, loc_city="  ", loc_country="")
    _refused(db, pid, "--status", "checked")


def test_the_place_in_the_same_command_is_enough_and_the_level_is_the_floor(db):
    pid = _make(db)
    done = _run(db, "position", str(pid), "--status", "checked", "--loc-city", "Milan", "--loc-country", "Italy")
    assert done.returncode == 0, done.stderr
    assert _read(db, pid, "status", "location_precision") == ("checked", "city")


def test_a_country_alone_is_a_place_and_its_level_is_country(db):
    pid = _make(db)
    assert _run(db, "position", str(pid), "--status", "checked", "--loc-country", "Italy").returncode == 0
    assert _read(db, pid, "status", "location_precision") == ("checked", "country")


def test_a_place_written_by_an_earlier_command_counts(db):
    pid = _make(db)
    assert _run(db, "position", str(pid), "--loc-city", "Dublin").returncode == 0
    assert _run(db, "position", str(pid), "--status", "checked").returncode == 0
    assert _read(db, pid, "status", "location_precision") == ("checked", "city")


@pytest.mark.parametrize(
    "extra",
    [("--remote-type", "full_remote"), ("--work-mode", "remote")],
)
def test_a_fully_remote_position_needs_no_country_and_its_level_is_remote(db, extra):
    pid = _make(db)
    done = _run(db, "position", str(pid), "--status", "checked", *extra)
    assert done.returncode == 0, done.stderr
    assert _read(db, pid, "status", "location_precision") == ("checked", "remote")


def test_a_row_that_is_already_fully_remote_passes_without_flags(db):
    pid = _make(db, remote_type="full_remote")
    assert _run(db, "position", str(pid), "--status", "checked").returncode == 0
    assert _read(db, pid, "location_precision")[0] == "remote"


def test_clearing_the_only_place_in_the_same_command_is_refused(db):
    pid = _make(db, loc_city="Rome")
    _refused(db, pid, "--status", "checked", "--loc-city", "")


def test_a_remote_position_with_a_city_gets_the_city_level(db):
    pid = _make(db, remote_type="full_remote", loc_city="Lisbon")
    assert _run(db, "position", str(pid), "--status", "checked").returncode == 0
    assert _read(db, pid, "location_precision")[0] == "city"


def test_a_level_that_is_already_there_is_not_touched(db):
    pid = _make(db, loc_city="Rome", location_precision="street", office_lat=41.9, office_lon=12.5)
    assert _run(db, "position", str(pid), "--status", "checked").returncode == 0
    assert _read(db, pid, "location_precision")[0] == "street"


def test_a_level_given_in_the_command_wins_over_the_floor(db):
    pid = _make(db, loc_city="Rome")
    done = _run(db, "position", str(pid), "--status", "checked", "--location-precision", "district")
    assert done.returncode == 0, done.stderr
    assert _read(db, pid, "location_precision")[0] == "district"


def test_a_row_that_is_already_checked_can_be_touched_without_a_place(db):
    pid = _make(db, status="checked")
    assert _run(db, "position", str(pid), "--notes", "tweaked").returncode == 0
    assert _run(db, "position", str(pid), "--status", "checked", "--notes", "again").returncode == 0
    assert _read(db, pid, "status", "location_precision") == ("checked", None)


@pytest.mark.parametrize("status", ["excluded", "scored", "new", "writing"])
def test_the_other_transitions_are_not_asked_for_a_place(db, status):
    pid = _make(db, status="checked")
    done = _run(db, "position", str(pid), "--status", status)
    assert done.returncode == 0, done.stderr


def test_the_error_is_in_english_and_says_how_to_fix_it(db):
    pid = _make(db)
    done = _run(db, "position", str(pid), "--status", "checked")
    assert "--loc-city" in done.stderr and "--loc-country" in done.stderr and "full_remote" in done.stderr
    assert done.stderr.isascii() or "⚠️" in done.stderr


# --- the prompts: the place is written before the promotion --------------------------------------


def _first(text: str, pattern: str) -> int:
    match = re.search(pattern, text)
    assert match, pattern
    return match.start()


@pytest.mark.parametrize("lang", LANGS)
def test_the_analyst_writes_the_place_before_it_promotes(lang):
    text = (ROOT / "agents" / "analista" / f"analista{lang}.md").read_text(encoding="utf-8")
    place = _first(text, r"--loc-city")
    promote = _first(text, r"db_update\.py position <ID> --status checked")
    assert place < promote


@pytest.mark.parametrize("lang", LANGS)
def test_the_enrichment_skill_tells_what_the_refusal_is(lang):
    text = (ROOT / "agents" / "_skills" / "location-enrichment" / f"SKILL{lang}.md").read_text(encoding="utf-8")
    promote = _first(text, r"db_update\.py position <ID> --status checked")
    assert "LOCATION_MISSING" in text[promote:]


@pytest.mark.parametrize("lang", LANGS)
def test_the_update_skill_example_for_checked_carries_a_place(lang):
    text = (ROOT / "agents" / "_skills" / "db-update" / f"SKILL{lang}.md").read_text(encoding="utf-8")
    lines = [ln for ln in text.splitlines() if "--status checked" in ln]
    assert lines and all("--loc-city" in ln or "--loc-country" in ln for ln in lines)


def test_no_prompt_or_skill_promotes_to_checked_in_a_command_that_the_rule_would_refuse():
    """Any command line that promotes must carry a place, or belong to a file the tests above cover."""
    covered = {"analista", "location-enrichment", "db-update", "db-query"}
    for path in list((ROOT / "agents").rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        for line in text.splitlines():
            if "db_update.py" in line and "--status checked" in line and "--loc-" not in line:
                assert covered & set(path.parts), f"{path}: {line.strip()}"
