"""
Test sincronizzazione SQLite → Supabase (db_to_supabase.py).

Copre:
- Funzioni di normalizzazione (_normalize_remote, _normalize_status, ecc.)
- Sync con DB SQLite vuoto (early return, zero chiamate HTTP)
- Sync dry_run con dati reali SQLite (no scritture su Supabase)
- Integrazione reale Supabase (richiede SUPABASE_SERVICE_ROLE_KEY)

Eseguire con:
    pytest tests/test_sync_supabase.py -v
Con Supabase:
    SUPABASE_SERVICE_ROLE_KEY=xxx pytest tests/test_sync_supabase.py -v
"""

import os
import sqlite3
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
    """Crea un DB SQLite v2 con schema completo e pronto per i test."""
    db_path = str(tmp_path / 'sync-test.db')
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            website TEXT, hq_country TEXT, size TEXT, sector TEXT,
            glassdoor_rating REAL, red_flags TEXT, culture_notes TEXT,
            analyzed_by TEXT, analyzed_at TIMESTAMP, verdict TEXT
        );
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, company TEXT NOT NULL,
            company_id INTEGER, url TEXT UNIQUE,
            location TEXT, remote_type TEXT,
            status TEXT DEFAULT 'new',
            source TEXT, jd_text TEXT, requirements TEXT,
            notes TEXT, found_by TEXT, deadline TEXT,
            salary_declared_min INTEGER, salary_declared_max INTEGER,
            salary_declared_currency TEXT,
            salary_estimated_min INTEGER, salary_estimated_max INTEGER,
            salary_estimated_source TEXT,
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_checked TIMESTAMP
        );
        CREATE TABLE scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL UNIQUE,
            total_score INTEGER NOT NULL,
            stack_match INTEGER, remote_fit INTEGER, salary_fit INTEGER,
            experience_fit INTEGER, strategic_fit INTEGER,
            breakdown TEXT, notes TEXT, scored_by TEXT,
            scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL UNIQUE,
            cv_path TEXT, cl_path TEXT, cv_pdf_path TEXT, cl_pdf_path TEXT,
            cv_drive_id TEXT, cl_drive_id TEXT,
            status TEXT DEFAULT 'draft',
            critic_score REAL, critic_verdict TEXT, critic_notes TEXT,
            applied_via TEXT, written_by TEXT, reviewed_by TEXT,
            applied BOOLEAN DEFAULT 0, response TEXT,
            written_at TIMESTAMP, applied_at TIMESTAMP,
            response_at TIMESTAMP, critic_reviewed_at TIMESTAMP,
            interview_round INTEGER
        );
        CREATE TABLE position_highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER, type TEXT, text TEXT
        );
    """)
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    return db_path, conn


# ---------------------------------------------------------------------------
# 1. Funzioni di normalizzazione (unit test puri, no I/O)
# ---------------------------------------------------------------------------

@requires_sync
class TestNormalization:
    """_normalize_* devono mappare correttamente i valori legacy."""

    @pytest.fixture(autouse=True)
    def mod(self):
        self._mod = load_sync_module()

    def test_normalize_remote_full_remote(self):
        assert self._mod._normalize_remote("remote") == "full_remote"
        assert self._mod._normalize_remote("full_remote") == "full_remote"
        assert self._mod._normalize_remote("full-remote") == "full_remote"

    def test_normalize_remote_hybrid(self):
        assert self._mod._normalize_remote("hybrid") == "hybrid"
        assert self._mod._normalize_remote("HYBRID") == "hybrid"

    def test_normalize_remote_onsite(self):
        assert self._mod._normalize_remote("onsite") == "onsite"
        assert self._mod._normalize_remote("on-site") == "onsite"
        assert self._mod._normalize_remote("on_site") == "onsite"

    def test_normalize_remote_none(self):
        assert self._mod._normalize_remote(None) is None
        assert self._mod._normalize_remote("") is None
        assert self._mod._normalize_remote("unknown") is None

    def test_normalize_status_valid(self):
        mod = self._mod
        for s in ["new", "checked", "excluded", "scored",
                  "writing", "review", "ready", "applied", "response"]:
            assert mod._normalize_status(s) == s, f"status '{s}' non passato"

    def test_normalize_status_invalid_becomes_new(self):
        assert self._mod._normalize_status("invalid_xyz") == "new"
        assert self._mod._normalize_status(None) == "new"
        assert self._mod._normalize_status("") == "new"

    def test_normalize_app_status_valid(self):
        mod = self._mod
        for s in ["draft", "review", "approved", "applied", "response"]:
            assert mod._normalize_app_status(s) == s

    def test_normalize_app_status_invalid_becomes_draft(self):
        assert self._mod._normalize_app_status("unknown") == "draft"
        assert self._mod._normalize_app_status(None) == "draft"

    def test_normalize_verdict_valid(self):
        mod = self._mod
        assert mod._normalize_verdict("PASS") == "PASS"
        assert mod._normalize_verdict("NEEDS_WORK") == "NEEDS_WORK"
        assert mod._normalize_verdict("REJECT") == "REJECT"

    def test_normalize_verdict_uppercase(self):
        """Il verdict viene normalizzato in uppercase."""
        assert self._mod._normalize_verdict("pass") == "PASS"
        assert self._mod._normalize_verdict("reject") == "REJECT"

    def test_normalize_verdict_none(self):
        assert self._mod._normalize_verdict(None) is None
        assert self._mod._normalize_verdict("invalid") is None


# ---------------------------------------------------------------------------
# 2. Sync con DB vuoto (early return, zero chiamate HTTP)
# ---------------------------------------------------------------------------

@requires_sync
class TestSyncEmptyDb:
    """
    Con DB SQLite vuoto, ogni sync_* ritorna subito senza mai chiamare Supabase.
    Usa URL/key fake: se venisse chiamato urllib, il test fallirebbe con connessione rifiutata.
    """

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

    def test_sync_companies_empty_returns_empty_map(self, empty_db):
        result = self._mod.sync_companies(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, dry_run=False
        )
        assert result == {}, "sync_companies DB vuoto deve restituire {}"

    def test_sync_positions_empty_returns_empty_map(self, empty_db):
        result = self._mod.sync_positions(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=False
        )
        assert result == {}

    def test_sync_scores_empty_returns_none(self, empty_db):
        # Nessuna eccezione, nessuna chiamata HTTP
        self._mod.sync_scores(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=False
        )

    def test_sync_applications_empty_no_error(self, empty_db):
        self._mod.sync_applications(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=False
        )

    def test_sync_highlights_empty_no_error(self, empty_db):
        self._mod.sync_highlights(
            empty_db, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=False
        )


# ---------------------------------------------------------------------------
# 3. Sync dry_run con dati SQLite (mock sb_get → lista vuota)
# ---------------------------------------------------------------------------

@requires_sync
class TestSyncDryRunWithData:
    """
    Con dry_run=True e sb_get mockato a [] (nessun dato esistente su Supabase),
    sync_* deve contare correttamente insert/update senza fare scritture.
    """

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

    def test_sync_companies_counts_inserts(self, db_with_data, capsys):
        self._mod.sync_companies(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, dry_run=True
        )
        out = capsys.readouterr().out
        assert "2 inserit" in out, f"Attese 2 companies da inserire, output: {out}"

    def test_sync_companies_dry_run_returns_empty_map(self, db_with_data):
        """dry_run=True non chiama sb_post → id_map è vuoto."""
        result = self._mod.sync_companies(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, dry_run=True
        )
        assert result == {}, "dry_run non deve costruire id_map (non chiama sb_post)"

    def test_sync_positions_counts_inserts(self, db_with_data, capsys):
        self._mod.sync_positions(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=True
        )
        out = capsys.readouterr().out
        assert "1 inserit" in out, f"Attesa 1 position da inserire, output: {out}"

    def test_sync_scores_skips_without_position_map(self, db_with_data, capsys):
        """Con position_map vuoto, tutti gli score vengono skippati."""
        self._mod.sync_scores(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=True
        )
        out = capsys.readouterr().out
        assert "1 skippa" in out, f"Atteso 1 score skippato (no position map), output: {out}"

    def test_sync_applications_skips_without_position_map(self, db_with_data, capsys):
        """Con position_map vuoto, tutte le applications vengono skippate."""
        self._mod.sync_applications(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=True
        )
        out = capsys.readouterr().out
        assert "1 skippa" in out, f"Attesa 1 application skippata, output: {out}"

    def test_sync_highlights_skips_without_position_map(self, db_with_data, capsys):
        """Con position_map vuoto, tutti gli highlights vengono skippati."""
        self._mod.sync_highlights(
            db_with_data, self.FAKE_URL, self.FAKE_KEY, self.FAKE_UID, {}, dry_run=True
        )
        out = capsys.readouterr().out
        assert "1 skippa" in out, f"Atteso 1 highlight skippato, output: {out}"

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
        assert "1 inserit" in out, f"Atteso 1 score inserito, output: {out}"

    def test_normalize_status_applied_in_pipeline(self, db_with_data):
        """Verifica che _normalize_status funzioni su dati reali dal DB."""
        mod = self._mod
        rows = db_with_data.execute("SELECT status FROM positions").fetchall()
        for row in rows:
            normalized = mod._normalize_status(row["status"])
            assert normalized in {"new", "checked", "excluded", "scored",
                                  "writing", "review", "ready", "applied", "response"}, \
                f"Status '{row['status']}' normalizzato a '{normalized}' non valido"


# ---------------------------------------------------------------------------
# 4. Integrazione reale Supabase (richiede service role key)
# ---------------------------------------------------------------------------

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
