"""O-73 — ``positions.status=applied`` e application sono un solo fatto."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
DB_UPDATE = SKILLS / "db_update.py"
DESKTOP_DB_UPDATE = (
    ROOT / "desktop" / "app-payload" / "shared" / "skills" / "db_update.py"
)
sys.path.insert(0, str(SKILLS))


@pytest.fixture()
def box(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import importlib
    import _db

    _db = importlib.reload(_db)
    conn = _db.get_db()
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company, status) "
        "VALUES (73, 'Synthetic role', 'Example company', 'ready')"
    )
    conn.commit()
    conn.close()
    return tmp_path / "jobs.db", tmp_path


def run_update(db_path: Path, home: Path, *args: str, script=DB_UPDATE):
    return subprocess.run(
        [sys.executable, str(script), *args],
        env={**os.environ, "JHT_DB": str(db_path), "JHT_HOME": str(home)},
        capture_output=True,
        text=True,
    )


def read_state(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    position = conn.execute(
        "SELECT status FROM positions WHERE id = 73"
    ).fetchone()
    application = conn.execute(
        "SELECT status, applied, applied_at, applied_via "
        "FROM applications WHERE position_id = 73"
    ).fetchone()
    transition = conn.execute(
        "SELECT from_state, to_state FROM position_state_transitions "
        "WHERE position_id = 73 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return position, application, transition


def test_position_only_applied_is_rejected_without_partial_state(box):
    db_path, home = box

    result = run_update(db_path, home, "position", "73", "--status", "applied")

    assert result.returncode == 1
    assert "APPLIED REJECTED" in result.stderr
    position, application, transition = read_state(db_path)
    assert position["status"] == "ready"
    assert application is None
    assert transition is None


def test_application_command_marks_both_surfaces_with_one_timestamp(box):
    db_path, home = box

    result = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "2026-08-12 15:30:00",
        "--applied-via",
        "telegram",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    position, application, transition = read_state(db_path)
    assert position["status"] == "applied"
    assert dict(application) == {
        "status": "applied",
        "applied": 1,
        "applied_at": "2026-08-12 15:30:00",
        "applied_via": "telegram",
    }
    assert dict(transition) == {"from_state": "ready", "to_state": "applied"}


def test_status_shortcut_materializes_timestamp_but_requires_via(box):
    db_path, home = box

    missing_via = run_update(
        db_path, home, "application", "73", "--status", "applied"
    )
    assert missing_via.returncode == 1
    assert read_state(db_path)[0]["status"] == "ready"

    complete = run_update(
        db_path,
        home,
        "application",
        "73",
        "--status",
        "applied",
        "--applied-via",
        "manual",
    )
    assert complete.returncode == 0, complete.stdout + complete.stderr
    _position, application, _transition = read_state(db_path)
    assert application["applied_at"] is not None
    assert application["applied_via"] == "manual"


@pytest.mark.parametrize("script", [DB_UPDATE, DESKTOP_DB_UPDATE])
def test_bare_applied_false_cannot_create_a_half_undo(box, script):
    db_path, home = box
    marked = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "2026-08-12 15:30:00",
        "--applied-via",
        "manual",
        script=script,
    )
    assert marked.returncode == 0, marked.stdout + marked.stderr

    rejected = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied",
        "false",
        script=script,
    )
    assert rejected.returncode == 1
    assert "APPLIED UNDO REJECTED" in rejected.stderr
    position, application, _transition = read_state(db_path)
    assert position["status"] == "applied"
    assert application["applied"] == 1
    assert application["applied_at"] == "2026-08-12 15:30:00"


def test_failure_after_application_write_rolls_back_everything(box):
    db_path, home = box
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TRIGGER synthetic_reject_applied_position
        BEFORE UPDATE OF status ON positions
        WHEN NEW.status = 'applied'
        BEGIN
          SELECT RAISE(ABORT, 'synthetic position failure');
        END;
    """)
    conn.close()

    result = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "now",
        "--applied-via",
        "telegram",
    )

    assert result.returncode != 0
    position, application, transition = read_state(db_path)
    assert position["status"] == "ready"
    assert application is None
    assert transition is None


def test_packaged_desktop_copy_enforces_the_same_applied_contract(box):
    db_path, home = box

    incomplete = run_update(
        db_path,
        home,
        "position",
        "73",
        "--status",
        "applied",
        script=DESKTOP_DB_UPDATE,
    )
    assert incomplete.returncode == 1
    assert read_state(db_path)[0]["status"] == "ready"

    complete = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "2026-08-12 15:30:00",
        "--applied-via",
        "desktop_manual",
        script=DESKTOP_DB_UPDATE,
    )
    assert complete.returncode == 0, complete.stdout + complete.stderr
    position, application, transition = read_state(db_path)
    assert position["status"] == "applied"
    assert dict(application) == {
        "status": "applied",
        "applied": 1,
        "applied_at": "2026-08-12 15:30:00",
        "applied_via": "desktop_manual",
    }
    assert dict(transition) == {"from_state": "ready", "to_state": "applied"}


def test_packaged_desktop_copy_rolls_back_a_partial_application(box):
    db_path, home = box
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TRIGGER synthetic_reject_desktop_applied
        BEFORE UPDATE OF status ON positions
        WHEN NEW.status = 'applied'
        BEGIN
          SELECT RAISE(ABORT, 'synthetic desktop position failure');
        END;
    """)
    conn.close()

    result = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "now",
        "--applied-via",
        "desktop_manual",
        script=DESKTOP_DB_UPDATE,
    )

    assert result.returncode != 0
    position, application, transition = read_state(db_path)
    assert position["status"] == "ready"
    assert application is None
    assert transition is None


def test_packaged_desktop_fresh_schema_records_undo_provenance(tmp_path):
    home = tmp_path / "desktop-fresh"
    db_path = home / "jobs.db"
    skills = DESKTOP_DB_UPDATE.parent
    seed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from _db import get_db, ensure_schema; "
                "c=get_db(); ensure_schema(c); "
                "c.execute(\"INSERT INTO positions "
                "(id,title,company,status) VALUES "
                "(73,'Synthetic role','Example company','ready')\"); "
                "c.commit(); c.close()"
            ),
        ],
        cwd=skills,
        env={**os.environ, "JHT_DB": str(db_path), "JHT_HOME": str(home)},
        capture_output=True,
        text=True,
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr

    result = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "2026-08-12 15:30:00",
        "--applied-via",
        "desktop_manual",
        script=DESKTOP_DB_UPDATE,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    position, application, transition = read_state(db_path)
    assert position["status"] == "applied"
    assert application["applied_at"] == "2026-08-12 15:30:00"
    assert dict(transition) == {"from_state": "ready", "to_state": "applied"}
