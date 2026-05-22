"""Test shared/skills/unstuck_positions.py.

Address anomalia #4 da docs/internal/2026-05-21-vps1-run-postmortem.md:
positions stuck in 'writing'/'checked' al boot dopo HALT/kill mid-run.

Eseguire:
    pytest tests/test_unstuck_positions.py -v
"""

import os
import sys
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')


@pytest.fixture()
def tmp_db_path(tmp_path, monkeypatch):
    """Setup DB temporaneo + JHT_DB env + reimport pulito di _db/unstuck."""
    db_path = str(tmp_path / 'jht-unstuck-test.db')
    monkeypatch.setenv('JHT_DB', db_path)

    # Forziamo re-import: _db.DB_PATH viene risolto a import-time leggendo
    # l'env. Senza pop, un test precedente lascia il path vecchio in modulo.
    for mod in ('_db', 'unstuck_positions'):
        sys.modules.pop(mod, None)

    if SKILLS_DIR not in sys.path:
        sys.path.insert(0, SKILLS_DIR)

    return db_path


def _seed_positions(db_path, rows):
    """rows = list[(title, company, status, hours_ago_updated)]."""
    # ensure_schema deve essere chiamato prima per creare la tabella.
    import _db as _db_module
    _db_module.DB_PATH = db_path  # override post-import
    conn = _db_module.get_db()
    _db_module.ensure_schema(conn)

    for title, company, status, hours_ago in rows:
        ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
        conn.execute(
            "INSERT INTO positions(title, company, status, updated_at) VALUES (?, ?, ?, ?)",
            (title, company, status, ts)
        )
    conn.commit()
    conn.close()


def _read_statuses(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, title, status, notes FROM positions ORDER BY id"
    ).fetchall()
    conn.close()
    return [(r['id'], r['title'], r['status'], r['notes']) for r in rows]


class TestUnstuckDryRun:
    def test_dry_run_no_changes(self, tmp_db_path, capsys):
        _seed_positions(tmp_db_path, [
            ('Stuck Writing', 'Acme', 'writing', 4),
            ('Fresh Writing', 'Beta', 'writing', 0.05),  # 3 min ago
        ])

        import unstuck_positions
        rc = unstuck_positions.main([])  # no --apply

        assert rc == 0
        rows = _read_statuses(tmp_db_path)
        # Nessuno status deve cambiare in dry-run
        assert rows[0][2] == 'writing'
        assert rows[1][2] == 'writing'
        # Stderr deve menzionare la stuck row
        captured = capsys.readouterr()
        assert 'Stuck Writing' in captured.err
        assert 'dry-run' in captured.err


class TestUnstuckApply:
    def test_reset_writing_to_scored(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Writing', 'Acme', 'writing', 4),
        ])

        import unstuck_positions
        rc = unstuck_positions.main(['--apply'])

        assert rc == 0
        rows = _read_statuses(tmp_db_path)
        assert rows[0][2] == 'scored', f"Expected scored, got {rows[0][2]}"
        # Audit note presente
        assert '[unstuck' in (rows[0][3] or ''), f"Missing audit note: {rows[0][3]!r}"

    def test_fresh_row_preserved(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Writing', 'Acme', 'writing', 4),
            ('Fresh Writing', 'Beta', 'writing', 0.05),
        ])

        import unstuck_positions
        unstuck_positions.main(['--apply'])

        rows = _read_statuses(tmp_db_path)
        assert rows[0][2] == 'scored'
        assert rows[1][2] == 'writing', "Fresh row must not be touched"

    def test_checked_not_touched_without_flag(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Checked', 'Acme', 'checked', 4),
            ('Stuck Writing', 'Beta', 'writing', 4),
        ])

        import unstuck_positions
        unstuck_positions.main(['--apply'])  # senza --include-checked

        rows = _read_statuses(tmp_db_path)
        # Checked deve restare invariato
        statuses = {r[1]: r[2] for r in rows}
        assert statuses['Stuck Checked'] == 'checked'
        assert statuses['Stuck Writing'] == 'scored'

    def test_checked_reset_with_include_checked(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Checked', 'Acme', 'checked', 4),
            ('Stuck Writing', 'Beta', 'writing', 4),
        ])

        import unstuck_positions
        unstuck_positions.main(['--apply', '--include-checked'])

        rows = _read_statuses(tmp_db_path)
        statuses = {r[1]: r[2] for r in rows}
        assert statuses['Stuck Checked'] == 'new'  # checked → new
        assert statuses['Stuck Writing'] == 'scored'

    def test_custom_stale_hours(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Old 3h', 'Acme', 'writing', 3),
            ('Recent 30min', 'Beta', 'writing', 0.5),
        ])

        import unstuck_positions
        # Threshold 1h: 3h stuck, 30min preserved
        unstuck_positions.main(['--apply', '--stale-hours', '1'])

        rows = _read_statuses(tmp_db_path)
        statuses = {r[1]: r[2] for r in rows}
        assert statuses['Old 3h'] == 'scored'
        assert statuses['Recent 30min'] == 'writing'

    def test_idempotent_rerun(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Writing', 'Acme', 'writing', 4),
        ])

        import unstuck_positions
        unstuck_positions.main(['--apply'])
        # Now status=scored, re-run should be no-op
        unstuck_positions.main(['--apply'])

        rows = _read_statuses(tmp_db_path)
        assert rows[0][2] == 'scored'
        # Audit note should appear only once (no double-stamping)
        notes = rows[0][3] or ''
        assert notes.count('[unstuck') == 1, \
            f"Expected exactly 1 [unstuck stamp, got {notes.count('[unstuck')}: {notes!r}"

    def test_audit_note_preserves_existing(self, tmp_db_path):
        _seed_positions(tmp_db_path, [
            ('Stuck Writing', 'Acme', 'writing', 4),
        ])
        # Inject existing notes
        conn = sqlite3.connect(tmp_db_path)
        conn.execute(
            "UPDATE positions SET notes='EXISTING_NOTE: scout flag' WHERE id=1"
        )
        conn.commit()
        conn.close()

        import unstuck_positions
        unstuck_positions.main(['--apply'])

        rows = _read_statuses(tmp_db_path)
        notes = rows[0][3] or ''
        assert 'EXISTING_NOTE: scout flag' in notes, "Original note lost"
        assert '[unstuck' in notes, "Audit note missing"


class TestUnstuckEmpty:
    def test_no_stuck_dry_run_message(self, tmp_db_path, capsys):
        _seed_positions(tmp_db_path, [
            ('Fresh', 'Acme', 'scored', 0.05),
        ])

        import unstuck_positions
        rc = unstuck_positions.main([])  # dry-run

        assert rc == 0
        captured = capsys.readouterr()
        assert 'no stuck positions' in captured.err

    def test_no_stuck_apply_zero_reset(self, tmp_db_path, capsys):
        _seed_positions(tmp_db_path, [
            ('Fresh', 'Acme', 'scored', 0.05),
        ])

        import unstuck_positions
        rc = unstuck_positions.main(['--apply'])

        assert rc == 0
        captured = capsys.readouterr()
        # Con --apply e zero stuck: nessun output di stuck listed, solo
        # "committed 0 reset(s)" (apply non passa dal ramo dry-run).
        assert 'committed 0' in captured.err
