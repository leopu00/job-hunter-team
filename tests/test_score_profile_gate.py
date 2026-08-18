"""Test gate "minimum viable profile" su insert_score (shared/skills).

Root cause coperta: incident 2026-07 — score persistito in `scores` per un
utente con profilo mai compilato (candidate_profile.yml assente). Il gate
UI/onboarding (isProfileComplete) non era replicato a valle e lo Scorer
degradava in modo permissivo.

Vincolo di design verificato qui: il gate blocca SOLO l'assenza sostanziale
del profilo — i profili parziali (che NON passerebbero validate_profile.py /
isProfileComplete) devono continuare a scorare. Non è una checklist di
completezza.

Eseguire:
    pytest tests/test_score_profile_gate.py -v
"""

import argparse
import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import profile_gate  # noqa: E402
import db_insert  # noqa: E402


# ---------------------------------------------------------------------------
# Fixture profili
# ---------------------------------------------------------------------------

# Minimo valido: target_role + un secondo segnale (il nome). Sotto questo
# livello lo score è insensato; questo DEVE passare.
MINIMAL_PROFILE = """\
name: "Test User"
target_role: "Python Developer"
"""

# Parziale realistico: fallirebbe validate_profile.py (mancano location,
# experience_years, has_degree, seniority_target, languages — tutti L1
# mandatori) ma è ben sopra la soglia del gate. Regressione da NON rompere:
# lo scoring con profili parziali è comportamento legittimo e voluto.
PARTIAL_PROFILE = """\
name: "Test User"
target_role: "Data Engineer"
skills:
  primary:
    - Python
    - SQL
"""

# Solo target_role, nessun altro segnale: degenere quanto un file vuoto
# (ogni sub-score sarebbe incalcolabile).
ONLY_TARGET_PROFILE = """\
target_role: "Python Developer"
"""

# Template docs/examples copiato ma mai compilato (placeholder name).
PLACEHOLDER_PROFILE = """\
name: "Nome Cognome"
target_role: "Backend Developer"
location: "Remote EU"
"""

# Schema annidato usato da alcuni produttori (candidate.target_role).
NESTED_PROFILE = """\
candidate:
  name: "Test User"
  target_role: "Frontend Developer"
"""


def _write_profile(tmp_path, content):
    profile_dir = tmp_path / 'profile'
    profile_dir.mkdir(parents=True, exist_ok=True)
    path = profile_dir / 'candidate_profile.yml'
    path.write_text(content, encoding='utf-8')
    return str(path)


# ---------------------------------------------------------------------------
# Unit test: check_minimum_viable_profile
# ---------------------------------------------------------------------------

class TestCheckMinimumViableProfile:

    def test_missing_file_rejected(self, tmp_path):
        ok, reason = profile_gate.check_minimum_viable_profile(
            str(tmp_path / 'profile' / 'candidate_profile.yml'))
        assert not ok
        assert 'is missing' in reason

    def test_empty_file_rejected(self, tmp_path):
        path = _write_profile(tmp_path, '')
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert not ok
        assert 'is empty' in reason

    def test_yaml_not_dict_rejected(self, tmp_path):
        path = _write_profile(tmp_path, '- solo\n- una\n- lista\n')
        ok, _ = profile_gate.check_minimum_viable_profile(path)
        assert not ok

    def test_invalid_yaml_rejected(self, tmp_path):
        path = _write_profile(tmp_path, 'name: "unclosed\n  {{{')
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert not ok
        assert 'could not be parsed' in reason

    def test_no_target_role_rejected(self, tmp_path):
        path = _write_profile(tmp_path, 'name: "Test User"\nlocation: "Milano"\n')
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert not ok
        assert 'target' in reason

    def test_only_target_role_rejected(self, tmp_path):
        path = _write_profile(tmp_path, ONLY_TARGET_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert not ok
        assert 'only target_role' in reason

    def test_placeholder_template_rejected(self, tmp_path):
        path = _write_profile(tmp_path, PLACEHOLDER_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert not ok
        assert 'template' in reason

    def test_minimal_profile_allowed(self, tmp_path):
        path = _write_profile(tmp_path, MINIMAL_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert ok, reason

    def test_partial_profile_allowed(self, tmp_path):
        """Profilo parziale (bocciato dal validatore L1) DEVE passare il gate."""
        path = _write_profile(tmp_path, PARTIAL_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert ok, reason

    def test_nested_candidate_schema_allowed(self, tmp_path):
        path = _write_profile(tmp_path, NESTED_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert ok, reason

    def test_target_roles_list_variant_allowed(self, tmp_path):
        path = _write_profile(
            tmp_path, 'target_roles:\n  - "DevOps Engineer"\nname: "Test User"\n')
        ok, reason = profile_gate.check_minimum_viable_profile(path)
        assert ok, reason

    def test_default_path_reads_jht_home(self, tmp_path, monkeypatch):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        _write_profile(tmp_path, MINIMAL_PROFILE)
        ok, reason = profile_gate.check_minimum_viable_profile()
        assert ok, reason

    def test_default_path_missing_jht_home_profile(self, tmp_path, monkeypatch):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        ok, _ = profile_gate.check_minimum_viable_profile()
        assert not ok


# ---------------------------------------------------------------------------
# Integration test: insert_score rifiuta/consente la scrittura in scores
# ---------------------------------------------------------------------------

@pytest.fixture()
def score_db(tmp_path, monkeypatch):
    """DB file temporaneo + get_db/ensure_schema patchati su db_insert."""
    db_path = str(tmp_path / 'jobs.db')

    def _get_db():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        # #195: con questo pragma REPLACE attiva il DELETE trigger. Così il
        # controllo sul tombstone fallisce davvero con il writer precedente.
        # La fixture non monta scores_touch_updated_at: con questo pragma quel
        # trigger può ricorrere se CURRENT_TIMESTAMP cade nello stesso secondo.
        conn.execute('PRAGMA recursive_triggers = ON')
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                position_id INTEGER NOT NULL UNIQUE,
                total_score INTEGER NOT NULL,
                stack_match INTEGER,
                remote_fit INTEGER,
                salary_fit INTEGER,
                experience_fit INTEGER,
                strategic_fit INTEGER,
                breakdown TEXT,
                notes TEXT,
                scored_by TEXT,
                scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS _tombstones (
                table_name TEXT NOT NULL,
                legacy_id INTEGER NOT NULL,
                deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (table_name, legacy_id)
            );
            CREATE TRIGGER IF NOT EXISTS scores_tombstone
            BEFORE DELETE ON scores FOR EACH ROW
            BEGIN
                INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
                VALUES ('scores', OLD.position_id, CURRENT_TIMESTAMP);
            END;
        """)
        return conn

    monkeypatch.setattr(db_insert, 'get_db', _get_db)
    monkeypatch.setattr(db_insert, 'ensure_schema', lambda conn: None)
    return _get_db


def _score_args(position_id=1, total=76):
    return argparse.Namespace(
        position_id=position_id, total=total,
        stack_match=None, remote_fit=None, salary_fit=None,
        experience_fit=None, strategic_fit=None,
        breakdown=None, notes=None, scored_by='scorer-test',
    )


def _count_scores(get_db):
    conn = get_db()
    n = conn.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
    conn.close()
    return n


class TestInsertScoreGate:

    def test_rejected_when_profile_missing(self, score_db, tmp_path, monkeypatch, capsys):
        # JHT_HOME punta a una dir senza profile/ → gate scatta, niente riga.
        monkeypatch.setenv('JHT_HOME', str(tmp_path / 'empty_home'))
        with pytest.raises(SystemExit) as exc:
            db_insert.insert_score(_score_args())
        assert exc.value.code == 1
        assert 'SCORE REJECTED' in capsys.readouterr().out
        assert _count_scores(score_db) == 0

    def test_allowed_with_minimal_profile(self, score_db, tmp_path, monkeypatch):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        _write_profile(tmp_path, MINIMAL_PROFILE)
        db_insert.insert_score(_score_args(position_id=1, total=76))
        assert _count_scores(score_db) == 1

    def test_allowed_with_partial_profile(self, score_db, tmp_path, monkeypatch):
        """Regressione: profilo parziale sopra soglia → lo scoring funziona."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        _write_profile(tmp_path, PARTIAL_PROFILE)
        db_insert.insert_score(_score_args(position_id=2, total=61))
        assert _count_scores(score_db) == 1

    def test_rescore_action_rewrites_score_and_advances_its_timestamp(
            self, score_db, tmp_path, monkeypatch):
        """O-70: il ticket deve produrre una nuova valutazione, non un ACK."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        _write_profile(tmp_path, MINIMAL_PROFILE)
        db_insert.insert_score(_score_args(position_id=3, total=60))

        conn = score_db()
        conn.execute(
            "UPDATE scores SET scored_at = '2000-01-01 00:00:00' "
            "WHERE position_id = 3")
        conn.commit()
        conn.close()

        # Lo storico è già coperto da test_maintenance_log; qui isoliamo
        # l'effetto del writer score e il timestamp che O-71 mostra in pagina.
        monkeypatch.setattr(
            db_insert.maintenance_log, 'record_diffs', lambda *a, **k: None)
        args = _score_args(position_id=3, total=75)
        args.action = 'rescore'
        args.outcome = 'updated'
        args.evidence_kind = None
        args.evidence_url = None
        args.evidence_code = None
        args.evidence_hash = None
        args.duration_ms = None
        db_insert.insert_score(args)

        conn = score_db()
        row = conn.execute(
            "SELECT total_score, scored_at FROM scores WHERE position_id = 3"
        ).fetchone()
        conn.close()
        assert row['total_score'] == 75
        assert row['scored_at'] != '2000-01-01 00:00:00'

    def test_rescore_keeps_score_identity_and_never_tombstones_it(
            self, score_db, tmp_path, monkeypatch):
        """#195: re-score è un UPDATE, non una delete+insert mascherata."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        _write_profile(tmp_path, MINIMAL_PROFILE)
        db_insert.insert_score(_score_args(position_id=4, total=60))

        conn = score_db()
        original_id = conn.execute(
            "SELECT id FROM scores WHERE position_id = 4"
        ).fetchone()['id']
        conn.close()

        db_insert.insert_score(_score_args(position_id=4, total=75))

        conn = score_db()
        row = conn.execute(
            "SELECT id, total_score FROM scores WHERE position_id = 4"
        ).fetchone()
        tombstones = conn.execute(
            "SELECT legacy_id FROM _tombstones WHERE table_name = 'scores'"
        ).fetchall()
        conn.close()

        assert row['id'] == original_id
        assert row['total_score'] == 75
        assert tombstones == []
