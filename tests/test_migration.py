"""
Test migrazione legacy → Job Hunter Team.

Verifica:
- Schema DB SQLite v2 (interview_round presente, PRAGMA user_version = 2)
- db_init.py su un DB legacy tronca le righe oltre i limiti e attiva i CHECK
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
