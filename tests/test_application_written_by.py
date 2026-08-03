"""Regression tests for applications.written_by attribution (#103)."""

import os
import sqlite3
import subprocess
import sys

import pytest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_INIT = os.path.join(SKILLS_DIR, 'db_init.py')
DB_INSERT = os.path.join(SKILLS_DIR, 'db_insert.py')
DB_UPDATE = os.path.join(SKILLS_DIR, 'db_update.py')


def run_cli(script, args, db_path, tmp_path):
    """Run a database CLI against an isolated SQLite file."""
    wrapper = tmp_path / '_written_by_wrapper.py'
    wrapper.write_text(f"""
import sys
sys.path.insert(0, {SKILLS_DIR!r})
import _db as _db_module
_db_module.DB_PATH = {db_path!r}
sys.argv = ['script'] + {list(args)!r}
with open({script!r}) as _f:
    _code = compile(_f.read(), {script!r}, 'exec')
exec(_code, {{'__file__': {script!r}, '__name__': '__main__'}})
""")
    return subprocess.run(
        [sys.executable, str(wrapper)], capture_output=True, text=True
    )


@pytest.fixture
def database(tmp_path):
    db_path = str(tmp_path / 'written-by.db')
    run_cli(DB_INIT, [], db_path, tmp_path)
    run_cli(DB_INSERT, [
        'position',
        '--title', 'Writer Attribution Test',
        '--company', 'AttributionCorp',
        '--url', 'https://attribution.example.com/job/1',
        '--source', 'test',
        '--found-by', 'qa-test',
    ], db_path, tmp_path)
    with sqlite3.connect(db_path) as conn:
        pos_id = conn.execute("SELECT id FROM positions LIMIT 1").fetchone()[0]
    return db_path, pos_id, tmp_path


def written_by(db_path, pos_id):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(
            "SELECT written_by FROM applications WHERE position_id = ?",
            (pos_id,),
        ).fetchone()[0]


def test_insert_uses_agent_identity_when_flag_is_omitted(database, monkeypatch):
    db_path, pos_id, tmp_path = database
    monkeypatch.setenv('JHT_AGENT_NAME', 'scrittore-env')

    result = run_cli(DB_INSERT, [
        'application', '--position-id', str(pos_id), '--cv-path', '/tmp/cv.md',
    ], db_path, tmp_path)

    assert result.returncode == 0, result.stderr
    assert written_by(db_path, pos_id) == 'scrittore-env'


def test_upsert_accepts_explicit_writer_on_insert(database, monkeypatch):
    db_path, pos_id, tmp_path = database
    monkeypatch.setenv('JHT_AGENT_NAME', 'scrittore-env')

    result = run_cli(DB_UPDATE, [
        'application', str(pos_id), '--cv-path', '/tmp/cv.md',
        '--written-by', 'scrittore-explicit',
    ], db_path, tmp_path)

    assert result.returncode == 0, result.stderr
    assert written_by(db_path, pos_id) == 'scrittore-explicit'


def test_upsert_backfills_writer_on_existing_application(database, monkeypatch):
    db_path, pos_id, tmp_path = database
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO applications (position_id) VALUES (?)", (pos_id,))
    monkeypatch.setenv('JHT_AGENT_NAME', 'scrittore-recovery')

    result = run_cli(DB_UPDATE, [
        'application', str(pos_id), '--cv-pdf-path', '/tmp/cv.pdf',
    ], db_path, tmp_path)

    assert result.returncode == 0, result.stderr
    assert written_by(db_path, pos_id) == 'scrittore-recovery'


def test_critic_update_does_not_claim_missing_writer(database, monkeypatch):
    db_path, pos_id, tmp_path = database
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO applications (position_id) VALUES (?)", (pos_id,))
    monkeypatch.setenv('JHT_AGENT_NAME', 'critico-1')

    result = run_cli(DB_UPDATE, [
        'application', str(pos_id),
        '--critic-verdict', 'PASS', '--reviewed-by', 'critico-1',
    ], db_path, tmp_path)

    assert result.returncode == 0, result.stderr
    assert written_by(db_path, pos_id) is None
