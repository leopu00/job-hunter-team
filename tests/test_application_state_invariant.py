"""O-73 — ``positions.status=applied`` e application sono un solo fatto."""

from __future__ import annotations

import os
import importlib.util
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
DB_UPDATE = SKILLS / "db_update.py"
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


def test_bare_applied_false_cannot_create_a_half_undo(box):
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
    )
    assert marked.returncode == 0, marked.stdout + marked.stderr

    rejected = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied",
        "false",
    )
    assert rejected.returncode == 1
    assert "APPLIED UNDO REJECTED" in rejected.stderr
    position, application, _transition = read_state(db_path)
    assert position["status"] == "applied"
    assert application["applied"] == 1
    assert application["applied_at"] == "2026-08-12 15:30:00"


def test_applied_application_status_cannot_be_downgraded_alone(box):
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
    )
    assert marked.returncode == 0, marked.stdout + marked.stderr

    rejected = run_update(
        db_path,
        home,
        "application",
        "73",
        "--status",
        "draft",
    )
    assert rejected.returncode == 1
    assert "APPLIED STATUS CHANGE REJECTED" in rejected.stderr
    position, application, _transition = read_state(db_path)
    assert position["status"] == "applied"
    assert application["status"] == "applied"


def test_downgrade_update_rechecks_position_under_write_lock():
    source = DB_UPDATE.read_text(encoding="utf-8")
    function = source[source.index("def update_application(args):"):]
    guard_read = function.index("SELECT status FROM positions")
    guarded_predicate = function.index(
        "AND NOT EXISTS (SELECT 1 FROM positions"
    )
    application_write = function.index("UPDATE applications SET")
    assert guard_read < guarded_predicate < application_write


def test_concurrent_applied_write_wins_over_stale_downgrade(box):
    db_path, home = box
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO applications (position_id, status, applied) "
        "VALUES (73, 'draft', 0)"
    )
    conn.commit()
    conn.close()

    selected = threading.Event()
    release = threading.Event()

    class GatedConnection(sqlite3.Connection):
        gated = False

        def execute(self, sql, parameters=()):
            cursor = super().execute(sql, parameters)
            if (
                not self.gated
                and " ".join(sql.split()).lower()
                == "select status from positions where id = ?"
                and tuple(parameters) == (73,)
            ):
                self.gated = True
                selected.set()
                assert release.wait(10), "concurrent writer never completed"
            return cursor

    def gated_get_db():
        guarded = sqlite3.connect(
            db_path, timeout=10, factory=GatedConnection
        )
        guarded.row_factory = sqlite3.Row
        guarded.execute("PRAGMA journal_mode=WAL")
        guarded.execute("PRAGMA foreign_keys=ON")
        return guarded

    spec = importlib.util.spec_from_file_location(
        "o73_db_update", DB_UPDATE
    )
    assert spec and spec.loader
    update_module = importlib.util.module_from_spec(spec)
    original_path = sys.path[:]
    try:
        spec.loader.exec_module(update_module)
    finally:
        # Entrambe le CLI inseriscono la propria directory in sys.path. Non
        # deve influenzare il reload di `_db` nelle fixture successive.
        sys.path[:] = original_path
    update_module.get_db = gated_get_db

    downgrade_result = {}

    def downgrade():
        old_argv = sys.argv
        sys.argv = ["db_update.py", "application", "73", "--status", "draft"]
        try:
            update_module.main()
            downgrade_result["code"] = 0
        except SystemExit as exc:
            downgrade_result["code"] = int(exc.code or 0)
        finally:
            sys.argv = old_argv

    thread = threading.Thread(target=downgrade, daemon=True)
    thread.start()
    assert selected.wait(10), "downgrade never reached its advisory read"

    marked = run_update(
        db_path,
        home,
        "application",
        "73",
        "--applied-at",
        "2026-08-12 15:30:00",
        "--applied-via",
        "manual",
    )
    release.set()
    thread.join(10)

    assert marked.returncode == 0, marked.stdout + marked.stderr
    assert not thread.is_alive()
    assert downgrade_result == {"code": 1}
    position, application, _transition = read_state(db_path)
    assert position["status"] == "applied"
    assert dict(application) == {
        "status": "applied",
        "applied": 1,
        "applied_at": "2026-08-12 15:30:00",
        "applied_via": "manual",
    }


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


def test_a_fresh_schema_records_undo_provenance(tmp_path):
    """Uno schema creato adesso, non quello della fixture.

    Girava sulla copia impacchettata in `desktop/app-payload/`, rimossa da
    #177 perche' residuo dell'app Electron. Il caso pero' non e' della copia:
    e' un DB nato da `ensure_schema` in una home nuova, che gli altri test qui
    non attraversano — quindi cambia il percorso, non sparisce.
    """
    home = tmp_path / "fresh"
    db_path = home / "jobs.db"
    skills = SKILLS
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
        "manual",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    position, application, transition = read_state(db_path)
    assert position["status"] == "applied"
    assert application["applied_at"] == "2026-08-12 15:30:00"
    assert dict(transition) == {"from_state": "ready", "to_state": "applied"}
