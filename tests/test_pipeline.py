"""
Test suite pipeline Job Hunter Team.

Testa i comandi CLI principali con un DB temporaneo isolato.
Ogni test è indipendente grazie alla fixture `tmp_db`.

Eseguire con: pytest tests/test_pipeline.py -v
"""

import os
import shutil
import stat
import sys
import sqlite3
import subprocess
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

DB_INIT = os.path.join(SKILLS_DIR, 'db_init.py')
DB_INSERT = os.path.join(SKILLS_DIR, 'db_insert.py')
DB_UPDATE = os.path.join(SKILLS_DIR, 'db_update.py')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
DB_MIGRATE_V2 = os.path.join(SKILLS_DIR, 'db_migrate_v2.py')
SETUP_SH = os.path.join(REPO_ROOT, 'setup.sh')


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def run_cli(script: str, args: list, db_path: str, tmp_path) -> subprocess.CompletedProcess:
    """
    Esegue uno script CLI con il DB temporaneo iniettato.

    Strategia: crea un wrapper .py che patcha _db.DB_PATH prima che lo script
    lo importi, poi esegue lo script con __file__ correttamente impostato.
    """
    wrapper = tmp_path / '_wrapper.py'
    wrapper.write_text(f"""
import sys, os

# 1. Pre-carica e patcha _db prima che lo script lo importi
sys.path.insert(0, {repr(SKILLS_DIR)})
import _db as _db_module
_db_module.DB_PATH = {repr(db_path)}

# 2. Imposta argv come se lo script fosse chiamato dalla CLI
sys.argv = ['script'] + {repr(list(args))}

# 3. Esegui lo script con __file__ corretto (necessario per os.path.dirname(__file__))
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

@pytest.fixture
def tmp_db(tmp_path):
    """DB temporaneo isolato per ogni test."""
    return str(tmp_path / 'jht-test.db')


# ---------------------------------------------------------------------------
# Test 1: db_init.py crea le tabelle corrette
# ---------------------------------------------------------------------------

class TestDbInit:

    def test_creates_all_tables(self, tmp_db, tmp_path):
        """db_init.py deve creare positions, companies, scores, applications."""
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)

        assert result.returncode == 0, f"db_init.py fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        conn.close()

        assert 'positions' in tables
        assert 'companies' in tables
        assert 'scores' in tables
        assert 'applications' in tables
        assert 'position_highlights' in tables

    def test_idempotent(self, tmp_db, tmp_path):
        """db_init.py deve poter girare più volte senza errori."""
        r1 = run_cli(DB_INIT, [], tmp_db, tmp_path)
        r2 = run_cli(DB_INIT, [], tmp_db, tmp_path)

        assert r1.returncode == 0
        assert r2.returncode == 0

    def test_output_contains_table_names(self, tmp_db, tmp_path):
        """L'output di db_init.py deve elencare le tabelle."""
        result = run_cli(DB_INIT, [], tmp_db, tmp_path)

        assert 'positions' in result.stdout
        assert 'companies' in result.stdout
        assert 'scores' in result.stdout
        assert 'applications' in result.stdout


# ---------------------------------------------------------------------------
# Test 2: db_insert.py position
# ---------------------------------------------------------------------------

class TestDbInsertPosition:

    def _init(self, tmp_db, tmp_path):
        run_cli(DB_INIT, [], tmp_db, tmp_path)

    def test_insert_position_basic(self, tmp_db, tmp_path):
        """db_insert.py position deve inserire senza errori e ritornare l'ID."""
        self._init(tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'position',
            '--title', 'Test Engineer',
            '--company', 'Test Corp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://test.example.com/job/42',
            '--source', 'test',
            '--found-by', 'qa-test',
            '--jd-text', 'Test JD content. Python required.',
            '--requirements', 'Python, pytest',
        ], tmp_db, tmp_path)

        assert result.returncode == 0, f"Insert fallito:\n{result.stderr}"
        assert 'inserita con ID' in result.stdout

    def test_insert_position_persisted_in_db(self, tmp_db, tmp_path):
        """La posizione inserita deve essere presente nel DB."""
        self._init(tmp_db, tmp_path)

        run_cli(DB_INSERT, [
            'position',
            '--title', 'Senior Python Dev',
            '--company', 'Acme SRL',
            '--location', 'Milan',
            '--remote-type', 'hybrid',
            '--url', 'https://acme.example.com/jobs/1',
            '--source', 'linkedin',
            '--found-by', 'scout-1',
        ], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        rows = conn.execute(
            "SELECT title, company, status FROM positions"
        ).fetchall()
        conn.close()

        assert len(rows) == 1
        assert rows[0][0] == 'Senior Python Dev'
        assert rows[0][1] == 'Acme SRL'
        assert rows[0][2] == 'new'  # status di default

    def test_insert_duplicate_rejected(self, tmp_db, tmp_path):
        """Inserire la stessa company+title deve essere bloccato."""
        self._init(tmp_db, tmp_path)

        args = [
            'position',
            '--title', 'Python Dev',
            '--company', 'Dup Corp',
            '--location', 'Remote',
            '--remote-type', 'full_remote',
            '--url', 'https://dupcorp.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ]
        run_cli(DB_INSERT, args, tmp_db, tmp_path)

        # Seconda insert con stesso titolo/azienda, URL diverso
        args2 = list(args)
        args2[args2.index('https://dupcorp.example.com/job/1')] = (
            'https://dupcorp.example.com/job/2'
        )
        result = run_cli(DB_INSERT, args2, tmp_db, tmp_path)

        # Deve segnalare duplicato
        assert result.returncode != 0 or 'DUPLICATO' in result.stdout


# ---------------------------------------------------------------------------
# Test 3: db_update.py position aggiorna status
# ---------------------------------------------------------------------------

class TestDbUpdatePosition:

    def _setup(self, tmp_db, tmp_path):
        """Init DB e inserisce una posizione di test, ritorna l'ID."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        run_cli(DB_INSERT, [
            'position',
            '--title', 'QA Update Test',
            '--company', 'UpdateCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://update.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)
        conn = sqlite3.connect(tmp_db)
        row = conn.execute("SELECT id FROM positions LIMIT 1").fetchone()
        conn.close()
        return row[0]

    def test_update_status_checked(self, tmp_db, tmp_path):
        """db_update.py deve aggiornare lo status a 'checked'."""
        pos_id = self._setup(tmp_db, tmp_path)

        result = run_cli(DB_UPDATE, [
            'position', str(pos_id), '--status', 'checked'
        ], tmp_db, tmp_path)

        assert result.returncode == 0, f"Update fallito:\n{result.stderr}"

        conn = sqlite3.connect(tmp_db)
        row = conn.execute(
            "SELECT status FROM positions WHERE id=?", (pos_id,)
        ).fetchone()
        conn.close()

        assert row[0] == 'checked'

    def test_update_status_scored(self, tmp_db, tmp_path):
        """db_update.py deve aggiornare lo status a 'scored'."""
        pos_id = self._setup(tmp_db, tmp_path)

        run_cli(DB_UPDATE, [
            'position', str(pos_id), '--status', 'scored'
        ], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        row = conn.execute(
            "SELECT status FROM positions WHERE id=?", (pos_id,)
        ).fetchone()
        conn.close()

        assert row[0] == 'scored'

    def test_update_nonexistent_position(self, tmp_db, tmp_path):
        """Update di una posizione inesistente non deve crashare con Traceback."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_UPDATE, [
            'position', '9999', '--status', 'checked'
        ], tmp_db, tmp_path)

        assert 'Traceback' not in result.stderr


# ---------------------------------------------------------------------------
# Test 4: db_insert.py score (verifica che non usi colonne pros/cons)
# ---------------------------------------------------------------------------

class TestDbInsertScore:

    def _setup(self, tmp_db, tmp_path):
        """Init DB e inserisce una posizione di test."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        run_cli(DB_INSERT, [
            'position',
            '--title', 'Score Test Position',
            '--company', 'ScoreCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://score.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)
        conn = sqlite3.connect(tmp_db)
        row = conn.execute("SELECT id FROM positions LIMIT 1").fetchone()
        conn.close()
        return row[0]

    def test_insert_score_succeeds(self, tmp_db, tmp_path):
        """db_insert.py score deve inserire senza errori (no colonne pros/cons)."""
        pos_id = self._setup(tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'score',
            '--position-id', str(pos_id),
            '--total', '75',
            '--stack-match', '30',
            '--remote-fit', '20',
            '--salary-fit', '15',
            '--experience-fit', '5',
            '--strategic-fit', '5',
            '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        assert result.returncode == 0, (
            f"Insert score fallito (possibile bug pros/cons):\n{result.stderr}"
        )
        assert '75/100' in result.stdout

    def test_score_persisted_in_db(self, tmp_db, tmp_path):
        """Lo score inserito deve essere recuperabile dal DB."""
        pos_id = self._setup(tmp_db, tmp_path)

        run_cli(DB_INSERT, [
            'score',
            '--position-id', str(pos_id),
            '--total', '85',
            '--stack-match', '35',
            '--remote-fit', '25',
            '--salary-fit', '15',
            '--experience-fit', '5',
            '--strategic-fit', '5',
            '--scored-by', 'qa-scorer',
        ], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        row = conn.execute(
            "SELECT total_score, stack_match, scored_by FROM scores WHERE position_id=?",
            (pos_id,)
        ).fetchone()
        conn.close()

        assert row is not None
        assert row[0] == 85
        assert row[1] == 35
        assert row[2] == 'qa-scorer'

    def test_score_no_pros_cons_columns(self, tmp_db, tmp_path):
        """La tabella scores NON deve avere colonne pros o cons (bug fixato)."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        cols = {row[1] for row in conn.execute(
            "PRAGMA table_info(scores)"
        ).fetchall()}
        conn.close()

        assert 'pros' not in cols, "Colonna 'pros' non deve esistere in scores"
        assert 'cons' not in cols, "Colonna 'cons' non deve esistere in scores"

    def test_score_fk_constraint_enforced(self, tmp_db, tmp_path):
        """Insert score con position_id inesistente deve fallire."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'score',
            '--position-id', '9999',
            '--total', '80',
            '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        # Deve fallire con FOREIGN KEY constraint
        assert result.returncode != 0


# ---------------------------------------------------------------------------
# Test 5: db_query.py dashboard non crasha su DB vuoto
# ---------------------------------------------------------------------------

class TestDbQueryDashboard:

    def test_dashboard_empty_db(self, tmp_db, tmp_path):
        """dashboard non deve crashare su DB vuoto."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['dashboard'], tmp_db, tmp_path)

        assert result.returncode == 0, f"dashboard crashato:\n{result.stderr}"
        assert 'Traceback' not in result.stderr
        assert 'JOB HUNTER' in result.stdout

    def test_stats_empty_db(self, tmp_db, tmp_path):
        """stats non deve crashare su DB vuoto."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['stats'], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'positions: 0' in result.stdout

    def test_positions_empty_db(self, tmp_db, tmp_path):
        """positions su DB vuoto non deve crashare."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['positions'], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'Traceback' not in result.stderr

    def test_next_for_scorer_empty_db(self, tmp_db, tmp_path):
        """next-for-scorer su DB vuoto deve ritornare messaggio 'nessuna'."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['next-for-scorer'], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'nessuna' in result.stdout.lower()

    def test_dashboard_with_data(self, tmp_db, tmp_path):
        """dashboard deve mostrare la posizione inserita."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        run_cli(DB_INSERT, [
            'position',
            '--title', 'Dashboard Test',
            '--company', 'DashCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://dash.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['dashboard'], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'Posizioni totali: 1' in result.stdout


# ---------------------------------------------------------------------------
# Test 6: validazione range score
# ---------------------------------------------------------------------------

class TestScoreRangeValidation:
    """Verifica che db_insert.py score rifiuti valori fuori range."""

    def _setup(self, tmp_db, tmp_path):
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        run_cli(DB_INSERT, [
            'position',
            '--title', 'Range Test Pos',
            '--company', 'RangeCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://range.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)
        conn = sqlite3.connect(tmp_db)
        row = conn.execute("SELECT id FROM positions LIMIT 1").fetchone()
        conn.close()
        return row[0]

    def test_score_range_total_over_100(self, tmp_db, tmp_path):
        """total=150 deve essere rifiutato (max 100). Atteso exit != 0."""
        pos_id = self._setup(tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'score',
            '--position-id', str(pos_id),
            '--total', '150',
            '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        assert result.returncode != 0, (
            "total=150 non dovrebbe essere accettato (max consentito: 100)"
        )

    def test_score_range_total_negative(self, tmp_db, tmp_path):
        """total=-5 deve essere rifiutato (min 0). Atteso exit != 0."""
        pos_id = self._setup(tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'score',
            '--position-id', str(pos_id),
            '--total', '-5',
            '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        assert result.returncode != 0, (
            "total=-5 non dovrebbe essere accettato (min consentito: 0)"
        )

    def test_score_range_stack_match_over_max(self, tmp_db, tmp_path):
        """stack_match=50 deve essere rifiutato (max 40). Atteso exit != 0."""
        pos_id = self._setup(tmp_db, tmp_path)

        result = run_cli(DB_INSERT, [
            'score',
            '--position-id', str(pos_id),
            '--total', '80',
            '--stack-match', '50',
            '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        assert result.returncode != 0, (
            "stack_match=50 non dovrebbe essere accettato (max consentito: 40)"
        )


# ---------------------------------------------------------------------------
# Test 7: db_update.py position inesistente → exit code != 0
# ---------------------------------------------------------------------------

class TestDbUpdateStricter:
    """Versione più rigorosa dei test update."""

    def test_update_nonexistent_position_returns_error(self, tmp_db, tmp_path):
        """Update di position 9999 (non esiste) deve restituire exit code != 0."""
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_UPDATE, [
            'position', '9999', '--status', 'checked'
        ], tmp_db, tmp_path)

        assert result.returncode != 0, (
            "Update di posizione inesistente deve fallire con exit != 0, "
            "non silenziosamente succedere"
        )

    def test_update_message_shows_value(self, tmp_db, tmp_path):
        """
        Il messaggio di conferma di db_update.py deve mostrare il valore
        effettivo ('checked'), non il placeholder SQL ('?').
        """
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        run_cli(DB_INSERT, [
            'position',
            '--title', 'Msg Test Pos',
            '--company', 'MsgCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', 'https://msg.example.com/job/1',
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        pos_id = conn.execute("SELECT id FROM positions LIMIT 1").fetchone()[0]
        conn.close()

        result = run_cli(DB_UPDATE, [
            'position', str(pos_id), '--status', 'checked'
        ], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'checked' in result.stdout, (
            f"Output deve contenere 'checked', non solo '?'. Output: {result.stdout!r}"
        )
        assert 'status = ?' not in result.stdout, (
            "Output non deve mostrare il placeholder SQL 'status = ?'"
        )


# ---------------------------------------------------------------------------
# Test 8: db_migrate_v2.py --verify non crasha su DB vuoto
# ---------------------------------------------------------------------------

class TestDbMigrateVerify:

    def test_verify_empty_db(self, tmp_db, tmp_path):
        """
        db_migrate_v2.py --verify non deve crashare con ZeroDivisionError
        quando positions è vuota (fix: guard su total == 0).
        """
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        result = run_cli(DB_MIGRATE_V2, ['--verify'], tmp_db, tmp_path)

        assert result.returncode == 0, (
            f"db_migrate_v2.py --verify crashato su DB vuoto:\n{result.stderr}"
        )
        assert 'ZeroDivisionError' not in result.stderr
        assert 'Traceback' not in result.stderr


# ---------------------------------------------------------------------------
# Test 9: db_init.py setta PRAGMA user_version = 2
# ---------------------------------------------------------------------------

class TestDbInitUserVersion:

    def test_user_version_set_to_2(self, tmp_db, tmp_path):
        """
        Dopo db_init.py, PRAGMA user_version deve essere 2 (schema V2).
        Fix già applicato in db_init.py: PRAGMA user_version = 2.
        """
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        conn = sqlite3.connect(tmp_db)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.close()

        assert version == 2, (
            f"PRAGMA user_version dovrebbe essere 2 (schema V2), trovato: {version}"
        )


# ---------------------------------------------------------------------------
# Test 10: next-for-analista e filtro next-for-scrittore per status
# ---------------------------------------------------------------------------

class TestDbQueryNextForExtended:

    def _insert_position(self, tmp_db, tmp_path, title, url, status='new'):
        """Helper: inserisce posizione e opzionalmente aggiorna lo status."""
        run_cli(DB_INSERT, [
            'position',
            '--title', title,
            '--company', 'TestCorp',
            '--location', 'Remote EU',
            '--remote-type', 'full_remote',
            '--url', url,
            '--source', 'test',
            '--found-by', 'qa-test',
        ], tmp_db, tmp_path)

        if status != 'new':
            conn = sqlite3.connect(tmp_db)
            pos_id = conn.execute(
                "SELECT id FROM positions WHERE url=?", (url,)
            ).fetchone()[0]
            conn.execute(
                "UPDATE positions SET status=? WHERE id=?", (status, pos_id)
            )
            conn.commit()
            conn.close()

        conn = sqlite3.connect(tmp_db)
        pos_id = conn.execute(
            "SELECT id FROM positions WHERE url=?", (url,)
        ).fetchone()[0]
        conn.close()
        return pos_id

    def test_next_for_analista(self, tmp_db, tmp_path):
        """
        db_query.py next-for-analista restituisce posizioni con status='new'.
        Non mostra posizioni già checked/scored.
        """
        run_cli(DB_INIT, [], tmp_db, tmp_path)
        self._insert_position(tmp_db, tmp_path, 'New Position', 'https://t.example.com/1', 'new')
        self._insert_position(tmp_db, tmp_path, 'Checked Position', 'https://t.example.com/2', 'checked')

        result = run_cli(DB_QUERY, ['next-for-analista'], tmp_db, tmp_path)

        assert result.returncode == 0, (
            f"next-for-analista crashato:\n{result.stderr}"
        )
        assert 'New Position' in result.stdout, "Deve mostrare posizioni con status=new"
        assert 'Checked Position' not in result.stdout, "Non deve mostrare posizioni già checked"

    def test_next_for_scrittore_filter_by_scored_status(self, tmp_db, tmp_path):
        """
        next-for-scrittore deve mostrare solo posizioni con p.status='scored'.
        Una posizione con status='checked' ma score >= 50 NON deve apparire.
        """
        run_cli(DB_INIT, [], tmp_db, tmp_path)

        # Posizione con status='scored' e score >= 50 → deve apparire
        scored_id = self._insert_position(
            tmp_db, tmp_path, 'Scored Position', 'https://t.example.com/10', 'scored'
        )
        run_cli(DB_INSERT, [
            'score', '--position-id', str(scored_id),
            '--total', '80', '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        # Posizione con status='checked' e score >= 50 → NON deve apparire
        checked_id = self._insert_position(
            tmp_db, tmp_path, 'Checked With Score', 'https://t.example.com/11', 'checked'
        )
        run_cli(DB_INSERT, [
            'score', '--position-id', str(checked_id),
            '--total', '75', '--scored-by', 'qa-test',
        ], tmp_db, tmp_path)

        result = run_cli(DB_QUERY, ['next-for-scrittore'], tmp_db, tmp_path)

        assert result.returncode == 0
        assert 'Scored Position' in result.stdout, (
            "Posizione con status='scored' deve apparire in next-for-scrittore"
        )
        assert 'Checked With Score' not in result.stdout, (
            "Posizione con status='checked' NON deve apparire in next-for-scrittore "
            "anche se ha score >= 50 — filtrare per p.status='scored'"
        )


# ---------------------------------------------------------------------------
# Test 11: setup.sh — esistenza, permessi, creazione venv
#
# Questi test sono marcati @pytest.mark.slow perché creano un venv reale.
# Eseguili con:  pytest tests/test_pipeline.py -m slow
# Escludili con: pytest tests/test_pipeline.py -m 'not slow'
# ---------------------------------------------------------------------------

class TestSetupScript:
    """
    Verifica il comportamento di setup.sh:
    esistenza/permessi, creazione venv, installazione dipendenze.

    test_setup_sh_exists — rapido, nessun xfail.
    test_setup_sh_creates_venv / test_venv_has_pyyaml — @pytest.mark.slow +
    @pytest.mark.xfail: setup.sh attualmente installa con pip3 di sistema e
    non crea un .venv. I test passeranno dopo che il backend aggiorna setup.sh.
    """

    @pytest.mark.slow
    def test_setup_sh_exists(self):
        """setup.sh deve esistere nella root e avere il bit eseguibile settato."""
        assert os.path.isfile(SETUP_SH), f"setup.sh non trovato in {SETUP_SH}"

        file_stat = os.stat(SETUP_SH)
        is_executable = bool(
            file_stat.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        )
        assert is_executable, (
            f"setup.sh non è eseguibile (mode: {oct(file_stat.st_mode)}). "
            "Fixare con: chmod +x setup.sh"
        )
        # Doppia verifica con os.access
        assert os.access(SETUP_SH, os.X_OK), "os.access(setup.sh, X_OK) restituisce False"

    @pytest.mark.slow
    def test_setup_sh_creates_venv(self, tmp_path):
        """
        Esegue setup.sh in una directory temporanea e verifica che crei
        .venv/bin/python3 e .venv/bin/pip3.

        Setup della temp dir:
          - setup.sh
          - .env.example
          - candidate_profile.yml.example
          - requirements.txt
          - shared/skills/ (necessario per db_init.py e db_migrate_v2.py)
          - shared/data/  (creata da setup.sh step 5, ma serve prima per i DB path)
        """
        # Copia i file necessari nella temp dir
        shutil.copy2(SETUP_SH, tmp_path / 'setup.sh')

        for fname in ('.env.example', 'candidate_profile.yml.example', 'requirements.txt'):
            src = os.path.join(REPO_ROOT, fname)
            if os.path.isfile(src):
                shutil.copy2(src, tmp_path / fname)

        # Copia shared/skills/ (db_init.py, _db.py, ecc.)
        shutil.copytree(
            os.path.join(REPO_ROOT, 'shared', 'skills'),
            tmp_path / 'shared' / 'skills',
        )
        # shared/data/ serve come destinazione del DB
        (tmp_path / 'shared' / 'data').mkdir(parents=True, exist_ok=True)

        result = subprocess.run(
            ['bash', str(tmp_path / 'setup.sh')],
            cwd=str(tmp_path),
            capture_output=True,
            text=True,
            timeout=120,
        )

        assert result.returncode == 0, (
            f"setup.sh uscito con codice {result.returncode}:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
        assert (tmp_path / '.venv' / 'bin' / 'python3').exists(), (
            ".venv/bin/python3 non trovato dopo setup.sh. "
            "setup.sh deve creare il venv con: python3 -m venv .venv"
        )
        assert (tmp_path / '.venv' / 'bin' / 'pip3').exists(), (
            ".venv/bin/pip3 non trovato dopo setup.sh."
        )

    @pytest.mark.slow
    def test_venv_has_pyyaml(self, tmp_path):
        """
        Dopo setup.sh, .venv/bin/python3 deve riuscire a importare yaml (pyyaml).
        Dipende da test_setup_sh_creates_venv: il venv deve esistere.
        """
        # Ricrea lo stesso ambiente della temp dir
        shutil.copy2(SETUP_SH, tmp_path / 'setup.sh')

        for fname in ('.env.example', 'candidate_profile.yml.example', 'requirements.txt'):
            src = os.path.join(REPO_ROOT, fname)
            if os.path.isfile(src):
                shutil.copy2(src, tmp_path / fname)

        shutil.copytree(
            os.path.join(REPO_ROOT, 'shared', 'skills'),
            tmp_path / 'shared' / 'skills',
        )
        (tmp_path / 'shared' / 'data').mkdir(parents=True, exist_ok=True)

        subprocess.run(
            ['bash', str(tmp_path / 'setup.sh')],
            cwd=str(tmp_path),
            capture_output=True,
            text=True,
            timeout=120,
        )

        venv_python = tmp_path / '.venv' / 'bin' / 'python3'
        assert venv_python.exists(), (
            ".venv/bin/python3 non trovato — setup.sh non ha creato il venv"
        )

        result = subprocess.run(
            [str(venv_python), '-c', 'import yaml; print(yaml.__version__)'],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, (
            f"'import yaml' fallito nel venv:\n{result.stderr}\n"
            "setup.sh deve installare pyyaml nel venv con: .venv/bin/pip3 install pyyaml"
        )


# ---------------------------------------------------------------------------
# Test 12: candidate_profile.yml — parsing profili non-dev e edge case
#
# Regressioni per BUG-NDV-01, BUG-NDV-02, BUG-NDV-03 fixati in PR #14.
# Strategia: copia shared/skills/ in tmp_path e scrive un candidate_profile.yml
# ad hoc, così check_profile_warnings() legge il profilo di test invece del
# profilo reale del repo.
# ---------------------------------------------------------------------------

class TestCandidateProfileParsing:
    """
    Verifica che db_init.py gestisca correttamente profili non-dev e edge case:

    - BUG-NDV-03: projects: [] → warning, non crash
    - BUG-NDV-02: candidate.skills con categorie libere (primary/secondary/learning)
    - BUG-NDV-01: scoring_weights con chiavi EN (growth/company)
    """

    def _run_db_init_with_profile(self, profile_yaml: str, tmp_path) -> subprocess.CompletedProcess:
        """
        Copia shared/skills/ in tmp_path, scrive candidate_profile.yml con il
        contenuto fornito, poi esegue db_init.py dal tmp con DB isolato.
        Il wrapper usa __file__ puntato alla copia tmp, così check_profile_warnings()
        risolve ../../candidate_profile.yml → tmp_path/candidate_profile.yml.
        """
        skills_tmp = tmp_path / 'shared' / 'skills'
        if not skills_tmp.exists():
            shutil.copytree(SKILLS_DIR, str(skills_tmp))

        (tmp_path / 'shared' / 'data').mkdir(parents=True, exist_ok=True)

        (tmp_path / 'candidate_profile.yml').write_text(profile_yaml)

        db_path = str(tmp_path / 'shared' / 'data' / 'jobs.db')
        tmp_db_init = str(skills_tmp / 'db_init.py')

        wrapper = tmp_path / '_wrapper_profile.py'
        wrapper.write_text(f"""
import sys, os
sys.path.insert(0, {repr(str(skills_tmp))})
import _db as _db_module
_db_module.DB_PATH = {repr(db_path)}
sys.argv = ['db_init.py']
with open({repr(tmp_db_init)}) as _f:
    _code = compile(_f.read(), {repr(tmp_db_init)}, 'exec')
exec(_code, {{'__file__': {repr(tmp_db_init)}, '__name__': '__main__'}})
""")
        return subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)

    def test_empty_projects_no_crash(self, tmp_path):
        """
        BUG-NDV-03: db_init.py non deve crashare se candidate.projects è [].
        Con pyyaml installato mostra anche un WARNING — verificato dove disponibile.
        Fix in PR #14: check_profile_warnings() in db_init.py.
        """
        profile = (
            'name: "Test NDV"\n'
            'candidate:\n'
            '  name: "Test NDV"\n'
            '  projects: []\n'
        )
        result = self._run_db_init_with_profile(profile, tmp_path)

        assert result.returncode == 0, (
            f"db_init.py crashato con projects:[]\n{result.stderr}"
        )
        assert 'Traceback' not in result.stderr
        assert 'ZeroDivisionError' not in result.stderr
        assert 'IndexError' not in result.stderr

        # Se pyyaml è disponibile, verifica anche che il warning sia stampato
        try:
            import yaml  # noqa: F401
            combined = result.stdout + result.stderr
            assert 'WARNING' in combined.upper(), (
                "pyyaml disponibile ma warning non trovato nell'output:\n"
                f"STDOUT: {result.stdout!r}\nSTDERR: {result.stderr!r}"
            )
        except ImportError:
            pass  # warning non mostrato se yaml mancante — comportamento atteso

    def test_nondev_skills_no_crash(self, tmp_path):
        """
        BUG-NDV-02: db_init.py non deve crashare se candidate.skills usa categorie
        libere (primary/secondary/learning) invece di languages/frameworks/databases.
        Fix in PR #14: scrittore itera su tutte le chiavi senza assumere nomi fissi.
        Verifica regressione: db_init non deve tentare di accedere a chiavi fisse.
        """
        profile = (
            'name: "Marketing Manager"\n'
            'candidate:\n'
            '  name: "Marketing Manager"\n'
            '  skills:\n'
            '    primary:\n'
            '      - "Campaign Management"\n'
            '      - "Brand Strategy"\n'
            '    secondary:\n'
            '      - "Data Analysis"\n'
            '    learning:\n'
            '      - "Python"\n'
            '  projects:\n'
            '    - name: "Campaign Q1"\n'
            '      description: "Lead campaign"\n'
            '      tech: []\n'
            '      url: ""\n'
        )
        result = self._run_db_init_with_profile(profile, tmp_path)

        assert result.returncode == 0, (
            f"db_init.py crashato con skills non-dev (primary/secondary/learning):\n"
            f"{result.stderr}"
        )
        assert 'Traceback' not in result.stderr
        assert 'KeyError' not in result.stderr

    def test_scoring_weights_en_keys_no_crash(self, tmp_path):
        """
        BUG-NDV-01: db_init.py non deve crashare se scoring_weights usa chiavi EN
        (growth/company) invece di IT (crescita/azienda).
        Fix in PR #14: candidate_profile.yml.example standardizzato su chiavi EN.
        Verifica regressione: db_init non tenta di accedere a 'crescita'/'azienda'.
        """
        profile = (
            'name: "Product Manager"\n'
            'scoring_weights:\n'
            '  stack_match: 35\n'
            '  remote_fit: 25\n'
            '  seniority_fit: 20\n'
            '  growth: 10\n'
            '  company: 10\n'
            'candidate:\n'
            '  name: "Product Manager"\n'
            '  projects:\n'
            '    - name: "Lancio Prodotto"\n'
            '      description: "Lancio prodotto B2B"\n'
            '      tech: []\n'
            '      url: ""\n'
        )
        result = self._run_db_init_with_profile(profile, tmp_path)

        assert result.returncode == 0, (
            f"db_init.py crashato con scoring_weights in chiavi EN:\n{result.stderr}"
        )
        assert 'Traceback' not in result.stderr
        assert 'KeyError' not in result.stderr
