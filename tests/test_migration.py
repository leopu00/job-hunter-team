"""
Test migrazione legacy → Job Hunter Team.

Verifica:
- Schema DB SQLite v2 (interview_round presente, PRAGMA user_version = 2)
- db_init.py su un DB legacy tronca le righe oltre i limiti e attiva i CHECK
- db_migrate_v2.py porta un DB V1 (schema ricostruito dalla storia) allo schema V2
- Integrità file di setup (setup.sh, .env.example, docs/examples/candidate_profile.yml.example)

Eseguire con:
    pytest tests/test_migration.py -v
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
# encoding='utf-8' esplicito: su Windows open() default e' cp1252 e fallisce
# su file con caratteri non-ASCII (es. accenti italiani nei commenti di
# db_init.py / db_migrate_v2.py).
with open({repr(script)}, encoding='utf-8') as _f:
    _code = compile(_f.read(), {repr(script)}, 'exec')
exec(_code, {{'__file__': {repr(script)}, '__name__': '__main__'}})
""", encoding='utf-8')
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
# 1. Schema DB corrente
# ---------------------------------------------------------------------------

class TestSchemaV2:
    """Lo schema corrente deve avere interview_round e user_version=7."""

    def test_db_init_creates_current_user_version(self, tmp_db, tmp_path):
        """db_init.py deve lasciare PRAGMA user_version alla versione corrente."""
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)
        assert result.returncode == 0, f"db_init fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.close()
        assert version == 7, f"PRAGMA user_version atteso 7, trovato {version}"

    def test_applications_has_interview_round(self, tmp_db, tmp_path):
        """La tabella applications deve avere interview_round (schema v2 in _db.py)."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(applications)").fetchall()]
        conn.close()
        assert "interview_round" in cols, \
            f"Colonna interview_round mancante in applications. Colonne: {cols}"

    def test_positions_has_length_constraints(self, tmp_db, tmp_path):
        """Fresh DB deve rifiutare INSERT con title/company/location over-length.

        Mirror del CHECK constraint Postgres (mig 015) — origin: incident
        RobertHalf 2026-05-19 (vedi docs/internal/architecture/cloud-sync-architecture.md).
        """
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)
        assert result.returncode == 0, f"db_init fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        # location > 200 char deve essere rifiutato
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO positions(title, company, location) VALUES (?, ?, ?)",
                ('ok', 'ok', 'x' * 201)
            )
        # title > 500 deve essere rifiutato
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO positions(title, company) VALUES (?, ?)",
                ('x' * 501, 'ok')
            )
        # company > 300 deve essere rifiutato
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO positions(title, company) VALUES (?, ?)",
                ('ok', 'x' * 301)
            )
        # Valori validi devono passare
        conn.execute(
            "INSERT INTO positions(title, company, location) VALUES (?, ?, ?)",
            ('Senior Engineer', 'Acme Corp', 'Milan, IT')
        )
        # location NULL deve passare (constraint e' "location IS NULL OR LENGTH <= 200")
        conn.execute(
            "INSERT INTO positions(title, company) VALUES (?, ?)",
            ('Engineer', 'Beta Corp')
        )
        conn.close()

    def test_migrate_truncates_legacy_over_length_rows(self, tmp_db, tmp_path):
        """Legacy DB con rows over-length: migration tronca e attiva constraint."""
        # Crea DB legacy senza CHECK constraint
        conn = sqlite3.connect(tmp_db)
        conn.executescript("""
            CREATE TABLE companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
            CREATE TABLE positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                company TEXT NOT NULL,
                location TEXT,
                status TEXT DEFAULT 'new'
            );
        """)
        # Inserisci 1 row con location lunga (simulando incident RobertHalf)
        conn.execute(
            "INSERT INTO positions(title, company, location) VALUES (?, ?, ?)",
            ('Engineer', 'Acme', 'x' * 400)
        )
        conn.execute(
            "INSERT INTO positions(title, company, location) VALUES (?, ?, ?)",
            ('Other', 'Beta', 'Milan')
        )
        conn.execute("PRAGMA user_version = 4")
        conn.commit()
        conn.close()

        # Run db_init (che applica ensure_schema → migrate chain)
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)
        assert result.returncode == 0, f"db_init fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        # Row over-length deve essere troncata, ma row valida deve restare
        rows = conn.execute(
            "SELECT title, company, LENGTH(location) FROM positions ORDER BY id"
        ).fetchall()
        assert len(rows) == 2, f"Expected 2 rows, got {len(rows)}: {rows}"
        # Row 1: location troncata a placeholder
        assert rows[0][2] <= 200, f"Row 1 location length {rows[0][2]} > 200 (non troncata)"
        # Row 2: location valida invariata
        assert rows[1][2] == 5, f"Row 2 location length expected 5 (Milan), got {rows[1][2]}"
        # Constraint deve essere ora attivo
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO positions(title, company, location) VALUES (?, ?, ?)",
                ('x', 'x', 'y' * 250)
            )
        conn.close()

# ---------------------------------------------------------------------------
# 1b. Un DB V1 vero portato a V2 da db_migrate_v2.py
# ---------------------------------------------------------------------------

# Lo schema V1 non è mai stato nel repo come file: il repo nasce già a V2
# (a1b95001c). Si ricostruisce da tre fonti che ci sono:
#   - le colonne che db_migrate_v2.py legge dalle tabelle *_old (step3);
#   - le colonne che il suo verify() pretende SPARITE dopo la migrazione;
#   - «CAMPI V1 RIMOSSI» in agents/capitano/capitano.md (3992daa12):
#     company_hq, work_location, salary_type, salary_min/max/currency.
# Le applications V1 non hanno written_at, response_at, interview_round né
# i drive id: sono i campi che la V2 aggiunge.
V1_SCHEMA = """
CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    company_hq TEXT,
    location TEXT,
    work_location TEXT,
    remote_type TEXT,
    salary_type TEXT,
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency TEXT,
    url TEXT,
    source TEXT,
    jd_text TEXT,
    requirements TEXT,
    found_by TEXT,
    found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deadline TEXT,
    status TEXT DEFAULT 'new',
    notes TEXT,
    last_checked TIMESTAMP
);
CREATE TABLE position_highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL
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
PRAGMA user_version = 1;
"""

# Righe sintetiche, una per regola della migrazione.
V1_ROWS = """
INSERT INTO companies (id, name) VALUES (1, 'Acme'), (2, 'Globex'), (3, 'Orphan Ltd');
INSERT INTO positions (id, title, company, company_hq, location, work_location, remote_type,
                       salary_type, salary_min, salary_max, salary_currency, url, status, found_by)
VALUES
  (1, 'Backend dev', 'acme', 'Milano', 'Italia', 'Torino', 'hybrid',
   'declared', 40000, 50000, NULL, 'https://jobs.example/1', 'scored', 'scout-1'),
  (2, 'Data eng', 'Globex', NULL, 'Roma', NULL, 'remote',
   'estimated', 30000, 45000, 'CHF', 'https://jobs.example/2', 'new', 'scout-1'),
  (3, 'SRE', 'Initech', NULL, NULL, '', 'onsite',
   NULL, 20000, 25000, NULL, 'https://jobs.example/3', 'checked', 'scout-2'),
  (4, 'Dup kept', 'Acme', NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'https://jobs.example/dup', 'ready', 'scout-1'),
  (5, 'Dup dropped', 'Acme', NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'https://jobs.example/dup', 'new', 'scout-2'),
  (6, 'Dead', 'Acme', NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'https://jobs.example/6', 'excluded', 'scout-2');
INSERT INTO position_highlights (id, position_id, type, text)
VALUES (1, 1, 'pro', 'Python'), (2, 6, 'con', 'gone with its position');
INSERT INTO scores (id, position_id, total_score, stack_match, breakdown, scored_by)
VALUES (1, 1, 72, 30, 'stack 30', 'scorer'), (2, 4, 81, 35, 'stack 35', 'scorer');
INSERT INTO applications (id, position_id, cv_path, critic_score, status, applied_at, applied_via, applied)
VALUES (1, 4, 'cv/4.md', 7.5, 'ready', NULL, NULL, 0);
"""


class TestMigrationV1ToV2:
    """db_migrate_v2.py su un DB V1: schema V2, dati spostati, ripulitura."""

    @pytest.fixture()
    def migrated(self, tmp_db, tmp_path):
        conn = sqlite3.connect(tmp_db)
        conn.executescript(V1_SCHEMA + V1_ROWS)
        conn.close()
        result = run_cli(DB_MIGRATE, [], tmp_db, tmp_path)
        assert result.returncode == 0, result.stdout[-2000:] + result.stderr[-2000:]
        assert "CHECK PASSED" in result.stdout, result.stdout[-2000:]
        conn = sqlite3.connect(tmp_db)
        conn.row_factory = sqlite3.Row
        yield conn
        conn.close()

    @staticmethod
    def _cols(conn, table):
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}

    def test_schema_is_v2(self, migrated):
        assert migrated.execute("PRAGMA user_version").fetchone()[0] == 2
        positions = self._cols(migrated, "positions")
        assert {"company_id", "salary_declared_min", "salary_declared_max",
                "salary_declared_currency", "salary_estimated_min",
                "salary_estimated_max", "salary_estimated_currency",
                "salary_estimated_source"} <= positions
        assert not positions & {"company_hq", "work_location", "salary_type",
                                "salary_min", "salary_max", "salary_currency"}
        assert {"written_at", "response_at", "interview_round",
                "cv_drive_id", "cl_drive_id"} <= self._cols(migrated, "applications")
        tables = {row[0] for row in migrated.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert not {t for t in tables if t.endswith("_old")}

    def test_salary_location_and_company_move_to_their_v2_columns(self, migrated):
        rows = {r["id"]: r for r in migrated.execute("SELECT * FROM positions")}
        declared, estimated, unknown = rows[1], rows[2], rows[3]
        # declared: i numeri vanno nel dichiarato, valuta di default EUR
        assert (declared["salary_declared_min"], declared["salary_declared_max"],
                declared["salary_declared_currency"]) == (40000, 50000, "EUR")
        assert declared["salary_estimated_min"] is None
        # estimated: nella stima, con la sua valuta e la fonte "manual"
        assert (estimated["salary_estimated_min"], estimated["salary_estimated_max"],
                estimated["salary_estimated_currency"],
                estimated["salary_estimated_source"]) == (30000, 45000, "CHF", "manual")
        assert estimated["salary_declared_min"] is None
        # senza tipo ma con numeri: dichiarato
        assert (unknown["salary_declared_min"], unknown["salary_declared_max"]) == (20000, 25000)
        # work_location vince su location; vuoto = assente
        assert declared["location"] == "Torino"
        assert estimated["location"] == "Roma"
        assert unknown["location"] is None
        # company_id dal nome, senza badare alle maiuscole; nessuna company = NULL
        assert declared["company_id"] == 1
        assert estimated["company_id"] == 2
        assert unknown["company_id"] is None
        assert declared["found_by"] == "scout-1" and declared["status"] == "scored"

    def test_cleanup_keeps_the_richer_duplicate_and_drops_the_dead(self, migrated):
        ids = {r[0] for r in migrated.execute("SELECT id FROM positions")}
        # dup: resta quella con score e application; excluded senza score né app: via
        assert ids == {1, 2, 3, 4}
        assert [r[0] for r in migrated.execute("SELECT position_id FROM position_highlights")] == [1]
        companies = {r[0] for r in migrated.execute("SELECT name FROM companies")}
        assert companies == {"Acme", "Globex"}

    def test_scores_and_applications_survive_with_the_new_fields_empty(self, migrated):
        scores = {r["position_id"]: r for r in migrated.execute("SELECT * FROM scores")}
        assert {pid: s["total_score"] for pid, s in scores.items()} == {1: 72, 4: 81}
        assert scores[4]["breakdown"] == "stack 35"
        app = migrated.execute("SELECT * FROM applications").fetchone()
        assert (app["position_id"], app["cv_path"], app["critic_score"], app["status"]) == (4, "cv/4.md", 7.5, "ready")
        assert app["written_at"] is None and app["response_at"] is None and app["interview_round"] is None

    def test_a_second_run_does_nothing(self, migrated, tmp_db, tmp_path):
        before = migrated.execute("SELECT count(*) FROM positions").fetchone()[0]
        again = run_cli(DB_MIGRATE, [], tmp_db, tmp_path)
        assert again.returncode == 0
        assert "already at version 2" in again.stdout
        assert migrated.execute("SELECT count(*) FROM positions").fetchone()[0] == before


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
        """docs/examples/candidate_profile.yml.example deve esistere — richiesto da setup.sh step 4."""
        path = os.path.join(REPO_ROOT, 'docs/examples/candidate_profile.yml.example')
        assert os.path.isfile(path), f"docs/examples/candidate_profile.yml.example mancante"

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

    def test_dev_team_start_sh_removed(self):
        """
        .launcher/start.sh NON deve tornare: rimosso il 2026-07-26.

        Assumeva claude+tmux sull'host (modello pre-container: oggi il team gira
        dentro il container ed è pid1/`jht team start` ad avviare gli agenti) e
        i suoi `&& true` neutralizzavano `set -e`, dichiarando successo anche
        con tutti gli spawn falliti. Nessun invocatore reale: solo questo test e
        un paio di messaggi di riepilogo in scripts/setup.*, ora aggiornati.
        """
        path = os.path.join(REPO_ROOT, '.launcher', 'start.sh')
        assert not os.path.exists(path), \
            ".launcher/start.sh è stato rimosso: l'avvio del team passa da `jht team start`"

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
