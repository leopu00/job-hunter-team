"""SQLite-to-Supabase normalization, empty sync, dry run and optional live integration."""

import os
import sqlite3
import sys
import importlib.util
import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SYNC_SCRIPT = os.path.join(SKILLS_DIR, 'db_to_supabase.py')

SUPABASE_URL         = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
HAS_SUPABASE         = bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)

has_sync_script = os.path.isfile(SYNC_SCRIPT)
requires_sync   = pytest.mark.skipif(
    not has_sync_script,
    reason="db_to_supabase.py non ancora mergiato (PR backend in corso)"
)
requires_supabase = pytest.mark.skipif(
    not HAS_SUPABASE,
    reason="Richiede SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
)


def load_sync_module():
    """Carica db_to_supabase.py tramite importlib senza eseguire main()."""
    spec = importlib.util.spec_from_file_location("db_to_supabase", SYNC_SCRIPT)
    mod  = importlib.util.module_from_spec(spec)
    # Evita che load_env() venga chiamata al caricamento del modulo
    spec.loader.exec_module(mod)
    return mod


def make_test_db(tmp_path):
    """Use the real schema so newly added columns are present in the fixture."""
    if SKILLS_DIR not in sys.path:
        sys.path.insert(0, SKILLS_DIR)
    import _db

    db_path = str(tmp_path / 'sync-test.db')
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.commit()
    return db_path, conn


@requires_sync
class TestNormalization:
    """Legacy values retain the same normalizer, order and expected result."""

    @pytest.fixture(autouse=True)
    def mod(self):
        self._mod = load_sync_module()

    @pytest.mark.parametrize('name,cases', [
        pytest.param('_normalize_remote', [('remote', 'full_remote'), ('full_remote', 'full_remote'),
                     ('full-remote', 'full_remote')], id='normalize_remote_full_remote'),
        pytest.param('_normalize_remote', [('hybrid', 'hybrid'), ('HYBRID', 'hybrid')],
                     id='normalize_remote_hybrid'),
        pytest.param('_normalize_remote', [('onsite', 'onsite'), ('on-site', 'onsite'),
                     ('on_site', 'onsite')], id='normalize_remote_onsite'),
        pytest.param('_normalize_remote', [(None, None), ('', None), ('unknown', None)],
                     id='normalize_remote_none'),
        pytest.param('_normalize_status', [(s, s) for s in (
                     'new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response')],
                     id='normalize_status_valid'),
        pytest.param('_normalize_status', [('invalid_xyz', 'new'), (None, 'new'), ('', 'new')],
                     id='normalize_status_invalid_becomes_new'),
        pytest.param('_normalize_app_status', [(s, s) for s in (
                     'draft', 'review', 'approved', 'applied', 'response')], id='normalize_app_status_valid'),
        pytest.param('_normalize_app_status', [('unknown', 'draft'), (None, 'draft')],
                     id='normalize_app_status_invalid_becomes_draft'),
        pytest.param('_normalize_verdict', [('PASS', 'PASS'), ('NEEDS_WORK', 'NEEDS_WORK'),
                     ('REJECT', 'REJECT')], id='normalize_verdict_valid'),
        pytest.param('_normalize_verdict', [('pass', 'PASS'), ('reject', 'REJECT')],
                     id='normalize_verdict_uppercase'),
        pytest.param('_normalize_verdict', [(None, None), ('invalid', None)], id='normalize_verdict_none'),
    ])
    def test_normalization(self, name, cases):
        for value, expected in cases:
            actual = getattr(self._mod, name)(value)
            if expected is None:
                assert actual is None
            else:
                assert actual == expected

@requires_sync
class TestSyncEmptyDb:
    """An empty database must not contact the fake server."""

    FAKE_URL = "https://fake-supabase-project.invalid"
    FAKE_KEY = "fake-service-key-00000000000000000000000"
    FAKE_UID = "00000000-0000-0000-0000-000000000000"

    @pytest.fixture()
    def empty_db(self, tmp_path):
        _, conn = make_test_db(tmp_path)
        return conn

    @pytest.fixture(autouse=True)
    def mod(self):
        self._mod = load_sync_module()

    @pytest.mark.parametrize('name,extra,expected', [
        pytest.param('sync_companies', (), {}, id='companies_empty_returns_empty_map'),
        pytest.param('sync_positions', ({},), {}, id='positions_empty_returns_empty_map'),
        pytest.param('sync_scores', ({},), None, id='scores_empty_returns_none'),
        pytest.param('sync_applications', ({},), None, id='applications_empty_no_error'),
        pytest.param('sync_highlights', ({},), None, id='highlights_empty_no_error'),
    ])
    def test_empty_sync(self, empty_db, name, extra, expected):
        result = getattr(self._mod, name)(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, *extra, dry_run=False)
        assert result == expected

@requires_sync
class TestSyncDryRunWithData:
    """Dry runs count new rows without writing to Supabase."""

    FAKE_URL = "https://fake-supabase-project.invalid"
    FAKE_KEY = "fake-service-key"
    FAKE_UID = "00000000-0000-0000-0000-000000000000"

    @pytest.fixture()
    def db_with_data(self, tmp_path):
        db_path, conn = make_test_db(tmp_path)
        conn.execute(
            "INSERT INTO companies (name, verdict) VALUES (?, ?)",
            ("TestCorp", "GO")
        )
        conn.execute(
            "INSERT INTO companies (name) VALUES (?)", ("AnotherCo",)
        )
        conn.execute(
            "INSERT INTO positions (title, company, url, status) VALUES (?, ?, ?, ?)",
            ("Dev Role", "TestCorp", "https://test.com/job/1", "scored")
        )
        conn.execute(
            "INSERT INTO scores (position_id, total_score) VALUES (1, 75)"
        )
        conn.execute(
            "INSERT INTO applications (position_id, status) VALUES (1, 'draft')"
        )
        conn.execute(
            "INSERT INTO position_highlights (position_id, type, text) VALUES (1, 'pro', 'buono stipendio')"
        )
        conn.commit()
        return conn

    @pytest.fixture(autouse=True)
    def mod_with_mock(self, monkeypatch):
        self._mod = load_sync_module()
        # Mocka sb_get per ritornare lista vuota (nessun esistente in Supabase)
        monkeypatch.setattr(self._mod, "sb_get", lambda *args, **kw: [])
        # Mocka sb_post per ritornare un record finto (con UUID)
        import uuid
        def fake_post(url, key, table, data, upsert_cols=None):
            if isinstance(data, list):
                return [{"id": str(uuid.uuid4())} for _ in data]
            return [{"id": str(uuid.uuid4())}]
        monkeypatch.setattr(self._mod, "sb_post", fake_post)
        monkeypatch.setattr(self._mod, "sb_patch", lambda *a, **kw: None)

    @pytest.mark.parametrize('name,extra,expected_output', [
        pytest.param('sync_companies', (), '2 inserted', id='companies_counts_inserts'),
        pytest.param('sync_positions', ({},), '1 inserted', id='positions_counts_inserts'),
        pytest.param('sync_scores', ({},), '1 skipped', id='scores_skips_without_position_map'),
        pytest.param('sync_applications', ({},), '1 skipped', id='applications_skips_without_position_map'),
        pytest.param('sync_highlights', ({},), '1 skipped', id='highlights_skips_without_position_map'),
    ])
    def test_dry_run_counts(self, db_with_data, capsys, name, extra, expected_output):
        getattr(self._mod, name)(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, *extra, dry_run=True)
        assert expected_output in capsys.readouterr().out

    def test_sync_companies_dry_run_returns_empty_map(self, db_with_data):
        result = self._mod.sync_companies(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, dry_run=True)
        assert result == {}, "dry_run must not build the id map"

    def test_sync_scores_with_position_map(self, db_with_data, capsys):
        """Con position_map corretto, gli score vengono sincronizzati."""
        import uuid
        fake_pos_uuid = str(uuid.uuid4())
        position_map = {1: fake_pos_uuid}
        self._mod.sync_scores(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID,
            position_map, dry_run=True
        )
        out = capsys.readouterr().out
        assert "1 inserted" in out, f"Atteso 1 score inserito, output: {out}"

    def test_normalize_status_applied_in_pipeline(self, db_with_data):
        """Verifica che _normalize_status funzioni su dati reali dal DB."""
        mod = self._mod
        rows = db_with_data.execute("SELECT status FROM positions").fetchall()
        for row in rows:
            normalized = mod._normalize_status(row["status"])
            assert normalized in {"new", "checked", "excluded", "scored",
                                  "writing", "review", "ready", "applied", "response"}, \
                f"Status '{row['status']}' normalizzato a '{normalized}' non valido"


@requires_sync
@requires_supabase
class TestSyncIntegration:
    """Verifica sync reale SQLite→Supabase con service role key."""

    def test_status_command_runs(self, tmp_path):
        """cmd_status deve girare e stampare conteggi."""
        import io
        from contextlib import redirect_stdout

        mod = load_sync_module()

        # Patcha get_db per usare un DB temporaneo vuoto
        _, tmp_conn = make_test_db(tmp_path)

        original_get_db = mod.get_db
        mod.get_db = lambda: tmp_conn

        f = io.StringIO()
        try:
            with redirect_stdout(f):
                mod.cmd_status()
        except SystemExit:
            pass
        finally:
            mod.get_db = original_get_db

        out = f.getvalue()
        assert "Tabella" in out or "positions" in out or "companies" in out, \
            f"cmd_status non ha stampato nulla di utile:\n{out}"

    @requires_supabase
    def test_sync_dry_run_against_real_supabase(self, tmp_path, capsys):
        """
        dry_run=True su DB SQLite vuoto deve completare senza errori
        e senza toccare i dati Supabase.
        """
        import subprocess
        import sys

        db_path, _ = make_test_db(tmp_path)

        env = os.environ.copy()
        env["SUPABASE_URL"] = SUPABASE_URL
        env["SUPABASE_SERVICE_ROLE_KEY"] = SUPABASE_SERVICE_KEY

        # Wrapper che redirige DB_PATH al DB temporaneo
        wrapper = tmp_path / '_sync_dry_run_wrapper.py'
        wrapper.write_text(f"""
import sys, os, importlib.util
sys.path.insert(0, {repr(SKILLS_DIR)})

# Patcha _db.DB_PATH
import _db as _db_module
_db_module.DB_PATH = {repr(db_path)}

spec = importlib.util.spec_from_file_location("db_to_supabase", {repr(SYNC_SCRIPT)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.get_db = _db_module.get_db

sys.argv = ['db_to_supabase.py', 'sync', '--dry-run']
mod.main()
""")
        r = subprocess.run([sys.executable, str(wrapper)], capture_output=True,
                           text=True, env=env)
        assert r.returncode == 0, f"sync --dry-run fallito:\n{r.stderr}"
        assert "Dry run: True" in r.stdout or "completato" in r.stdout.lower(), \
            f"Output inatteso:\n{r.stdout}"
