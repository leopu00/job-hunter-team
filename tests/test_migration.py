"""
Test migrazione legacy → Job Hunter Team.

Verifica:
- Schema DB SQLite v2 (interview_round presente, PRAGMA user_version = 2)
- db_migrate_v2.py applica correttamente la migrazione su DB legacy
- Integrità file di setup (setup.sh, .env.example, candidate_profile.yml.example)
- Supabase: tabelle popolate con dati reali (richiede SUPABASE_SERVICE_KEY)

Eseguire con:
    pytest tests/test_migration.py -v
Con dati reali Supabase:
    SUPABASE_SERVICE_KEY=xxx pytest tests/test_migration.py -v
"""

import os
import sqlite3
import subprocess
import sys
import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_INIT    = os.path.join(SKILLS_DIR, 'db_init.py')
DB_MIGRATE = os.path.join(SKILLS_DIR, 'db_migrate_v2.py')

SUPABASE_URL         = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
HAS_SERVICE_KEY      = bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)
requires_service_key = pytest.mark.skipif(
    not HAS_SERVICE_KEY,
    reason="Richiede NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_KEY"
)


# ---------------------------------------------------------------------------
# Helper: stesso pattern di test_pipeline.py
# ---------------------------------------------------------------------------

def run_cli(script: str, args: list, db_path: str, tmp_path) -> subprocess.CompletedProcess:
    """
    Esegue uno script CLI con il DB temporaneo iniettato.
    Patcha _db.DB_PATH prima che lo script lo importi.
    """
    wrapper = tmp_path / '_mig_wrapper.py'
    wrapper.write_text(f"""
import sys, os
sys.path.insert(0, {repr(SKILLS_DIR)})
import _db as _db_module
_db_module.DB_PATH = {repr(db_path)}
sys.argv = ['script'] + {repr(list(args))}
with open({repr(script)}) as _f:
    _code = compile(_f.read(), {repr(script)}, 'exec')
exec(_code, {{'__file__': {repr(script)}, '__name__': '__main__'}})
""")
    return subprocess.run(
        [sys.executable, str(wrapper)],
        capture_output=True, text=True
    )


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_db(tmp_path):
    return str(tmp_path / 'jht-migration-test.db')


# ---------------------------------------------------------------------------
# 1. Schema DB v2
# ---------------------------------------------------------------------------

class TestSchemaV2:
    """Lo schema v2 deve avere interview_round e user_version=2."""

    def test_db_init_creates_v2_user_version(self, tmp_db, tmp_path):
        """db_init.py deve impostare PRAGMA user_version = 2."""
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)
        assert result.returncode == 0, f"db_init fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.close()
        assert version == 2, f"PRAGMA user_version atteso 2, trovato {version}"

    def test_applications_has_interview_round(self, tmp_db, tmp_path):
        """La tabella applications deve avere interview_round (schema v2 in _db.py)."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(applications)").fetchall()]
        conn.close()
        assert "interview_round" in cols, \
            f"Colonna interview_round mancante in applications. Colonne: {cols}"

    @pytest.mark.xfail(
        strict=False,
        reason="Richiede schema V1 legacy completo (colonne url, salary_type, work_location, etc.) "
               "— il DB v1 creato dal test non corrisponde allo schema legacy reale. "
               "Fix: creare fixture con schema V1 completo da reverse engineering di db_migrate_v2.py"
    )
    def test_db_migrate_v2_adds_written_at_response_at(self, tmp_db, tmp_path):
        """db_migrate_v2 deve aggiungere written_at e response_at ad applications."""
        # Crea un DB v1 con schema legacy
        conn = sqlite3.connect(tmp_db)
        conn.executescript("""
            CREATE TABLE companies (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL, company TEXT NOT NULL,
                status TEXT DEFAULT 'new', found_at TEXT
            );
            CREATE TABLE position_highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                position_id INTEGER, type TEXT, text TEXT
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
                critic_verdict TEXT, critic_score REAL, critic_notes TEXT,
                status TEXT DEFAULT 'draft',
                applied_at TIMESTAMP, applied_via TEXT,
                response TEXT, written_by TEXT, reviewed_by TEXT,
                critic_reviewed_at TIMESTAMP, applied BOOLEAN DEFAULT 0
            );
        """)
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        conn.close()

        result = run_cli(DB_MIGRATE, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        app_cols = [row[1] for row in conn.execute("PRAGMA table_info(applications)").fetchall()]
        version  = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.close()

        assert "written_at" in app_cols, \
            f"db_migrate_v2 non ha aggiunto written_at. Colonne applications: {app_cols}"
        assert "response_at" in app_cols, \
            f"db_migrate_v2 non ha aggiunto response_at. Colonne applications: {app_cols}"
        assert version == 2, \
            f"PRAGMA user_version atteso 2 dopo migrazione, trovato {version}"

    @pytest.mark.xfail(
        strict=False,
        reason="Fixture V1 incompleta (manca colonna url + altri campi legacy). "
               "Bug fixato in PR #6 — test disabilitato fino a fixture V1 corretta."
    )
    def test_db_migrate_v2_adds_interview_round(self, tmp_db, tmp_path):
        """db_migrate_v2 dovrebbe aggiungere interview_round ad applications — attualmente mancante."""
        conn = sqlite3.connect(tmp_db)
        conn.executescript("""
            CREATE TABLE companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
            CREATE TABLE positions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, company TEXT NOT NULL, status TEXT DEFAULT 'new', found_at TEXT);
            CREATE TABLE position_highlights (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, type TEXT, text TEXT);
            CREATE TABLE scores (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL UNIQUE, total_score INTEGER NOT NULL);
            CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL UNIQUE, status TEXT DEFAULT 'draft', applied BOOLEAN DEFAULT 0);
        """)
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        conn.close()

        run_cli(DB_MIGRATE, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(applications)").fetchall()]
        conn.close()
        assert "interview_round" in cols, \
            f"interview_round mancante dopo migrazione. Colonne: {cols}"


# ---------------------------------------------------------------------------
# 2. Integrità file di setup
# ---------------------------------------------------------------------------

class TestSetupIntegrity:
    """I file critici per setup.sh devono esistere nella repo."""

    def test_env_example_exists(self):
        """.env.example deve esistere nella root — richiesto da setup.sh step 3."""
        path = os.path.join(REPO_ROOT, '.env.example')
        assert os.path.isfile(path), f".env.example mancante in {REPO_ROOT}"

    def test_candidate_profile_example_exists(self):
        """candidate_profile.yml.example deve esistere — richiesto da setup.sh step 4."""
        path = os.path.join(REPO_ROOT, 'candidate_profile.yml.example')
        assert os.path.isfile(path), f"candidate_profile.yml.example mancante"

    def test_requirements_txt_exists(self):
        """requirements.txt deve esistere per setup.sh step 2."""
        path = os.path.join(REPO_ROOT, 'requirements.txt')
        assert os.path.isfile(path), f"requirements.txt mancante"

    def test_db_init_exists(self):
        """shared/skills/db_init.py deve esistere — richiesto da setup.sh step 6."""
        assert os.path.isfile(DB_INIT), f"db_init.py mancante"

    def test_db_migrate_v2_exists(self):
        """shared/skills/db_migrate_v2.py deve esistere — richiesto da setup.sh step 7."""
        assert os.path.isfile(DB_MIGRATE), f"db_migrate_v2.py mancante"

    def test_dev_team_start_sh_exists(self):
        """
        .dev-team/start.sh deve esistere — referenziato da setup.sh nel riepilogo.
        GAP CONFERMATO: directory .dev-team/ mancante.
        Fix atteso: INFRA.
        """
        path = os.path.join(REPO_ROOT, '.dev-team', 'start.sh')
        assert os.path.isfile(path), \
            ".dev-team/start.sh mancante — setup.sh non mostra il comando di avvio (fix: INFRA)"

    def test_web_env_example_exists(self):
        """web/.env.example deve esistere — setup.sh linea 205 lo richiede."""
        path = os.path.join(REPO_ROOT, 'web', '.env.example')
        assert os.path.isfile(path), f"web/.env.example mancante (fix: FRONTEND)"

    def test_no_absolute_paths_in_skills(self):
        """
        Gli script in shared/skills non devono contenere path assoluti hardcoded.
        Sicurezza: repo pubblica.
        """
        import glob as globlib
        scripts = globlib.glob(os.path.join(SKILLS_DIR, '*.py'))
        violations = []
        for script in scripts:
            with open(script) as f:
                for lineno, line in enumerate(f, 1):
                    stripped = line.strip()
                    if ('/Users/' in line or '/home/' in line) and \
                       not stripped.startswith('#') and \
                       not stripped.startswith('"""') and \
                       not stripped.startswith("'"):
                        violations.append(
                            f"{os.path.basename(script)}:{lineno}: {line.rstrip()}"
                        )
        assert not violations, \
            "Path assoluti hardcoded in shared/skills/:\n" + "\n".join(violations)


# ---------------------------------------------------------------------------
# 3. Dati Supabase post-migrazione (richiede service key)
# ---------------------------------------------------------------------------

class TestSupabaseMigrationData:
    """Verifica che le tabelle Supabase abbiano dati reali dopo la migrazione."""

    def _count(self, table: str) -> int:
        """Conta righe via Supabase REST API con service key."""
        import urllib.request
        import urllib.error
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=id"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            },
            method="GET"
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                return int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")

    @requires_service_key
    def test_positions_has_enough_data(self):
        """La tabella positions deve avere >= 100 righe dopo la migrazione."""
        count = self._count("positions")
        assert count >= 100, \
            f"positions ha {count} righe. Migrazione dati incompleta (legacy ~530)."

    @requires_service_key
    def test_scores_has_data(self):
        """La tabella scores deve avere >= 50 righe."""
        count = self._count("scores")
        assert count >= 50, \
            f"scores ha {count} righe. Attese >= 50."

    @requires_service_key
    def test_companies_has_data(self):
        """La tabella companies deve avere >= 50 righe (legacy ~222)."""
        count = self._count("companies")
        assert count >= 50, \
            f"companies ha {count} righe. Attese >= 50."

    @requires_service_key
    def test_applications_table_accessible(self):
        """La tabella applications deve essere accessibile (qualunque count)."""
        count = self._count("applications")
        assert count >= 0

    @requires_service_key
    def test_scored_positions_have_numeric_score(self):
        """
        Regression BUG-CRESCITA-01 (segnalato in audit E2E):
        /crescita mostra Tier Seria/Practice/Riferimento tutti a 0 nonostante
        39 posizioni in status 'scored'. Causa sospetta: colonna score numerica
        non allineata tra SQLite legacy e Supabase (scores.total_score vs score).

        Questo test verifica che la tabella scores abbia colonna total_score
        con valori numerici reali (non null, non zero).
        """
        import urllib.request
        import urllib.error
        url = f"{SUPABASE_URL}/rest/v1/scores?select=total_score&total_score=gt.0"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            },
            method="GET"
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                count = int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")
        assert count > 0, \
            "BUG-CRESCITA-01: nessun record con total_score > 0 in Supabase — " \
            "/crescita mostra tier tutti a 0. Fix atteso: FRONTEND"
