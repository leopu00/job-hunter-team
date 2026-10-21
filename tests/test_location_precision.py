"""JHT-T04 — the level of precision of a place: the column, its migration, its writer.

`positions.location_precision` is one of address | street | district | city | country | remote, or
NULL for «not classified». It replaces nothing (`office_verified` stays) but the flag becomes
derived: true only for `address`. Here:

- the column and its CHECK exist on a fresh database, on a migrated one, and on a legacy one whose
  table is REBUILT by the three older migrations (they run first, and the column is put back after);
- the migration classifies the rows that already have a place, once, and never rewrites a level;
- db_update writes the level, keeps the flag in step, refuses a contradiction before writing,
  and never lowers a level on its own.
"""

from __future__ import annotations

import os
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
LEVELS = ("address", "street", "district", "city", "country", "remote")


def _fresh(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    return conn


def _precision_sql(conn: sqlite3.Connection) -> str:
    return conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'").fetchone()["sql"]


def test_the_levels_the_code_writes_are_exactly_the_ones_the_cloud_accepts():
    assert _db.LOCATION_PRECISIONS == LEVELS
    sql = (ROOT / "supabase" / "migrations" / "095_positions_location_precision.sql").read_text(encoding="utf-8")
    import re

    in_sql = tuple(re.findall(r"'([a-z]+)'", re.search(r"IN \(([^)]*)\)", sql).group(1)))
    assert in_sql == LEVELS


def test_a_fresh_database_has_the_column_and_refuses_anything_outside_the_set(tmp_path):
    conn = _fresh(tmp_path / "jobs.db")
    assert "location_precision" in {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    conn.execute("INSERT INTO positions (title, company) VALUES ('a', 'b')")
    assert conn.execute("SELECT location_precision FROM positions").fetchone()[0] is None
    for level in LEVELS:
        conn.execute("UPDATE positions SET location_precision = ?", (level,))
    for bad in ("building", "ADDRESS", "", " city"):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE positions SET location_precision = ?", (bad,))


# Tables as the three older rebuilds leave or find them: no CHECK at all, a status CHECK without
# `review` and `last_actor`, and a full one without the length checks.
def _era_table(status_check: str) -> str:
    """The positions table of the first rebuilds: the 23 columns that era's migrations copy in order."""
    return (
        "CREATE TABLE positions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, company TEXT NOT NULL, "
        "company_id INTEGER, location TEXT, remote_type TEXT, salary_declared_min INTEGER, salary_declared_max INTEGER, "
        "salary_declared_currency TEXT DEFAULT 'EUR', salary_estimated_min INTEGER, salary_estimated_max INTEGER, "
        "salary_estimated_currency TEXT DEFAULT 'EUR', salary_estimated_source TEXT, url TEXT, source TEXT, jd_text TEXT, "
        "requirements TEXT, found_by TEXT, found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deadline TEXT, "
        f"status TEXT DEFAULT 'new' {status_check}, notes TEXT, last_checked TIMESTAMP)"
    )


LEGACY = {
    "no_check_at_all": (2, _era_table("")),
    "status_check_without_review": (
        3,
        _era_table("CHECK (status IN ('new','checked','scored','writing','ready','applied','response','excluded'))"),
    ),
    "no_length_checks": (
        7,
        """CREATE TABLE positions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, company TEXT NOT NULL,
           company_id INTEGER, location TEXT, remote_type TEXT, url TEXT,
           status TEXT DEFAULT 'new' CHECK (status IN ('new','checked','scored','writing','review','ready','applied','response','excluded')),
           notes TEXT, last_checked TIMESTAMP, last_actor TEXT,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""",
    ),
}


@pytest.mark.parametrize("name", sorted(LEGACY))
def test_a_legacy_table_rebuilt_by_the_older_migrations_ends_with_the_column_and_its_check(tmp_path, name):
    version, create = LEGACY[name]
    path = tmp_path / "legacy.db"
    # the rest of the schema as it is now; only the positions table goes back to the shape of its era
    raw = _fresh(path)
    raw.execute("PRAGMA foreign_keys = OFF")
    for kind, name in raw.execute("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')").fetchall():
        raw.execute(f'DROP {kind} "{name}"')  # they point at positions; the schema creates them again
    raw.execute("DROP TABLE positions")
    raw.execute(create)
    raw.execute("INSERT INTO positions (title, company, status) VALUES ('Engineer', 'Acme', 'checked')")
    raw.execute(f"PRAGMA user_version = {version}")
    raw.commit()
    raw.close()

    conn = _fresh(path)
    assert [r["title"] for r in conn.execute("SELECT title FROM positions")] == ["Engineer"], "the row survives"
    assert "location_precision" in {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    assert "location_precision IN" in " ".join(_precision_sql(conn).split()), "and so does the CHECK"
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE positions SET location_precision = 'building'")
    conn.execute("UPDATE positions SET location_precision = 'street'")


def _old_database(path: Path) -> sqlite3.Connection:
    """A database from before the column: the canonical table without it, five rows with a place."""
    conn = _fresh(path)
    # SQLite cannot drop a CHECKed column in place; rebuild the table without it, as an old one was.
    columns = [r["name"] for r in conn.execute("PRAGMA table_info(positions)") if r["name"] != "location_precision"]
    conn.executescript(
        f"""
        ALTER TABLE positions RENAME TO positions_with;
        CREATE TABLE positions AS SELECT {', '.join(columns)} FROM positions_with WHERE 0;
        DROP TABLE positions_with;
        """
    )
    rows = [
        # (title, lat, lon, verified, remote_type, work_mode)
        ("verified-address", 41.89, 12.48, 1, "onsite", None),
        ("city-centre", 41.90, 12.50, 0, "hybrid", None),
        ("flag-null-with-coords", 45.46, 9.19, None, "onsite", None),
        ("remote-no-place", None, None, 0, "full_remote", None),
        ("remote-by-mode", None, None, 0, None, "remote"),
        ("onsite-no-place", None, None, 0, "onsite", None),
        ("verified-without-coords", None, None, 1, "onsite", None),
    ]
    for title, lat, lon, verified, remote_type, work_mode in rows:
        conn.execute(
            "INSERT INTO positions (title, company, office_lat, office_lon, office_verified, remote_type, work_mode) "
            "VALUES (?, 'Acme', ?, ?, ?, ?, ?)",
            (title, lat, lon, verified, remote_type, work_mode),
        )
    conn.commit()
    return conn


def test_the_migration_classifies_the_rows_that_have_a_place_and_only_those(tmp_path):
    conn = _old_database(tmp_path / "old.db")
    assert "location_precision" not in {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    _db._migrate_positions_location_precision(conn)
    got = {r["title"]: r["location_precision"] for r in conn.execute("SELECT title, location_precision FROM positions")}
    assert got == {
        "verified-address": "address",
        "city-centre": "city",
        "flag-null-with-coords": "city",       # a flag that is not 1 is not a verification
        "remote-no-place": "remote",
        "remote-by-mode": "remote",
        "onsite-no-place": None,               # no place and not remote: nothing to say
        "verified-without-coords": None,       # a flag with nothing under it is not an address
    }
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE positions SET location_precision = 'building'")


def test_the_migration_is_safe_to_run_again_and_never_rewrites_a_level(tmp_path):
    conn = _old_database(tmp_path / "old.db")
    _db._migrate_positions_location_precision(conn)
    conn.execute("UPDATE positions SET location_precision = 'street' WHERE title = 'verified-address'")
    conn.execute("UPDATE positions SET location_precision = 'district' WHERE title = 'city-centre'")
    before = [tuple(r) for r in conn.execute("SELECT title, location_precision FROM positions ORDER BY id")]
    _db._migrate_positions_location_precision(conn)
    _db._migrate_positions_location_precision(conn)
    assert [tuple(r) for r in conn.execute("SELECT title, location_precision FROM positions ORDER BY id")] == before


# ── the writer ───────────────────────────────────────────────────────────────


def _run(db: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(DB_UPDATE), *args],
        cwd=ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
    )


@pytest.fixture
def position(tmp_path):
    db = tmp_path / "jobs.db"
    conn = _fresh(db)
    cursor = conn.execute(
        "INSERT INTO positions (title, company, status, office_lat, office_lon) VALUES ('Engineer', 'Acme', 'checked', 41.89, 12.48)"
    )
    conn.commit()
    conn.close()
    return db, cursor.lastrowid


def _row(db: Path, pid: int):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT location_precision, office_verified FROM positions WHERE id = ?", (pid,)).fetchone()
    finally:
        conn.close()


@pytest.mark.parametrize(("level", "flag"), [("address", 1), ("street", 0), ("district", 0), ("city", 0), ("country", 0), ("remote", 0)])
def test_the_level_is_written_and_the_flag_follows_it(position, level, flag):
    db, pid = position
    done = _run(db, "position", str(pid), "--location-precision", level)
    assert done.returncode == 0, done.stderr
    assert _row(db, pid) == (level, flag)
    assert f"location_precision={level}" in done.stdout


def test_a_level_outside_the_set_is_refused_by_the_parser_and_nothing_is_written(position):
    db, pid = position
    done = _run(db, "position", str(pid), "--location-precision", "building")
    assert done.returncode == 2 and "invalid choice" in done.stderr
    assert _row(db, pid) == (None, 0)


@pytest.mark.parametrize(("level", "flag"), [("street", "true"), ("city", "true"), ("address", "false")])
def test_a_flag_that_contradicts_the_level_is_refused_before_anything_is_written(position, level, flag):
    db, pid = position
    # a position that already has its level: opening the database classifies the rows that have none,
    # so the level the refusal must leave alone is one that was written before the command
    conn = sqlite3.connect(db)
    conn.execute("UPDATE positions SET location_precision = 'district' WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    done = _run(db, "position", str(pid), "--location-precision", level, "--office-verified", flag, "--notes", "must not land")
    assert done.returncode == 1 and "LOCATION_PRECISION REJECTED" in done.stderr
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT notes, location_precision FROM positions WHERE id = ?", (pid,)).fetchone() == (None, "district")


def test_the_level_and_a_flag_that_agree_are_written_together(position):
    db, pid = position
    assert _run(db, "position", str(pid), "--location-precision", "address", "--office-verified", "true").returncode == 0
    assert _row(db, pid) == ("address", 1)


def test_the_flag_alone_from_an_older_skill_gives_the_level_the_rule_says(position):
    db, pid = position
    assert _run(db, "position", str(pid), "--office-verified", "true").returncode == 0
    assert _row(db, pid) == ("address", 1)
    assert _run(db, "position", str(pid), "--office-verified", "false").returncode == 0
    assert _row(db, pid) == ("address", 0), "a level is never lowered by a flag"


def test_a_false_flag_on_a_position_with_coordinates_and_no_level_says_city(position):
    db, pid = position
    assert _run(db, "position", str(pid), "--office-verified", "false").returncode == 0
    assert _row(db, pid) == ("city", 0)


def test_the_flag_alone_with_no_coordinates_says_no_level(tmp_path):
    db = tmp_path / "jobs.db"
    conn = _fresh(db)
    pid = conn.execute("INSERT INTO positions (title, company, status) VALUES ('Engineer', 'Acme', 'checked')").lastrowid
    conn.commit()
    conn.close()
    assert _run(db, "position", str(pid), "--office-verified", "true").returncode == 0
    assert _row(db, pid) == (None, 1)
    # and the coordinates given in the same call count
    assert _run(db, "position", str(pid), "--office-lat", "41.9", "--office-lon", "12.5", "--office-verified", "true").returncode == 0
    assert _row(db, pid) == ("address", 1)


def test_nothing_about_the_place_leaves_the_level_alone(position):
    db, pid = position
    assert _run(db, "position", str(pid), "--location-precision", "street").returncode == 0
    assert _run(db, "position", str(pid), "--notes", "ciao", "--office-address", "Via Roma").returncode == 0
    assert _row(db, pid) == ("street", 0)
