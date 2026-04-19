"""
Test flusso pipeline agenti — Job Hunter Team QA.

Verifica il flusso end-to-end: Scout → Analista → Scorer → Scrittore → Critico.
Ogni step usa i comandi CLI reali (db_insert, db_query, db_update) su un DB temporaneo.

Flusso pipeline:
  new → checked (Analista) → scored (Scorer, score>=50) → writing (Scrittore) → review → ready (Critico)

Eseguire con:
    pytest tests/test_pipeline_agents.py -v
"""

import os
import sqlite3
import subprocess
import sys
import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_INIT    = os.path.join(SKILLS_DIR, 'db_init.py')
DB_INSERT  = os.path.join(SKILLS_DIR, 'db_insert.py')
DB_UPDATE  = os.path.join(SKILLS_DIR, 'db_update.py')
DB_QUERY   = os.path.join(SKILLS_DIR, 'db_query.py')
SCOUT_COORD = os.path.join(SKILLS_DIR, 'scout_coord.py')

AGENTS_DIR = os.path.join(REPO_ROOT, 'agents')
RATE_SENTINEL = os.path.join(REPO_ROOT, 'shared', 'skills', 'rate_sentinel.py')

# ---------------------------------------------------------------------------
# Helper (stesso pattern di test_pipeline.py)
# ---------------------------------------------------------------------------

def run_cli(script: str, args: list, db_path: str, tmp_path) -> subprocess.CompletedProcess:
    wrapper = tmp_path / '_ag_wrapper.py'
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
    return subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)


@pytest.fixture()
def fresh_db(tmp_path):
    """DB inizializzato e pronto all'uso."""
    db_path = str(tmp_path / 'pipeline-test.db')
    result = run_cli(DB_INIT, [], db_path, tmp_path)
    assert result.returncode == 0, f"db_init fallito:\n{result.stderr}"
    return db_path, tmp_path


# ---------------------------------------------------------------------------
# Helpers comuni
# ---------------------------------------------------------------------------

def insert_position(db_path, tmp, title, company, url=None, source='test', found_by='scout-1'):
    url = url or f'https://example.com/{company.lower()}-{title.lower().replace(" ", "-")}'
    r = run_cli(DB_INSERT, [
        'position', '--title', title, '--company', company,
        '--url', url, '--source', source, '--found-by', found_by,
    ], db_path, tmp)
    assert r.returncode == 0, f"insert position fallito:\n{r.stderr}"
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT id FROM positions WHERE company=? AND title=? ORDER BY id DESC LIMIT 1",
        (company, title)
    ).fetchone()
    conn.close()
    return row[0] if row else None


def update_position(db_path, tmp, pos_id, **kwargs):
    args = ['position', str(pos_id)]
    for k, v in kwargs.items():
        args += [f'--{k}', str(v)]
    return run_cli(DB_UPDATE, args, db_path, tmp)


def insert_score(db_path, tmp, pos_id, total=75):
    # Ranges: stack 0-40, remote 0-25, salary 0-20, experience 0-10, strategic 0-15
    return run_cli(DB_INSERT, [
        'score', '--position-id', str(pos_id), '--total', str(total),
        '--stack', '15', '--remote', '15', '--salary', '15',
        '--experience', '10', '--strategic', '15',
    ], db_path, tmp)


# ---------------------------------------------------------------------------
# 1. Flusso Scout
# ---------------------------------------------------------------------------

class TestScoutFlow:
    """Scout inserisce posizioni in status='new'."""

    def test_scout_insert_position_new_status(self, fresh_db):
        """Una posizione inserita deve avere status='new' di default."""
        db_path, tmp = fresh_db
        pos_id = insert_position(db_path, tmp, 'Backend Python Dev', 'TestCo')
        assert pos_id is not None

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT status, found_by FROM positions WHERE id=?", (pos_id,)).fetchone()
        conn.close()
        assert row[0] == 'new', f"Status atteso 'new', trovato '{row[0]}'"
        assert row[1] == 'scout-1', f"found_by errato: '{row[1]}'"

    def test_scout_next_for_analista_finds_new_positions(self, fresh_db):
        """db_query next-for-analista deve trovare posizioni in status='new'."""
        db_path, tmp = fresh_db
        for i in range(3):
            insert_position(db_path, tmp, f'Dev Role {i}', f'Company{i}')

        r = run_cli(DB_QUERY, ['next-for-analista'], db_path, tmp)
        assert r.returncode == 0, f"next-for-analista fallito:\n{r.stderr}"
        assert 'Dev Role' in r.stdout or 'Company' in r.stdout, \
            f"next-for-analista non ha trovato posizioni new.\nOutput: {r.stdout}"

    def test_scout_found_by_tracked(self, fresh_db):
        """Il campo found_by deve essere registrato correttamente per ogni scout."""
        db_path, tmp = fresh_db
        id1 = insert_position(db_path, tmp, 'Role A', 'CoA', found_by='scout-1')
        id2 = insert_position(db_path, tmp, 'Role B', 'CoB', found_by='scout-2')

        conn = sqlite3.connect(db_path)
        fb1 = conn.execute("SELECT found_by FROM positions WHERE id=?", (id1,)).fetchone()[0]
        fb2 = conn.execute("SELECT found_by FROM positions WHERE id=?", (id2,)).fetchone()[0]
        conn.close()
        assert fb1 == 'scout-1'
        assert fb2 == 'scout-2'


# ---------------------------------------------------------------------------
# 2. Flusso Analista
# ---------------------------------------------------------------------------

class TestAnalistaFlow:
    """Analista porta le posizioni da 'new' a 'checked'."""

    def test_analista_updates_status_to_checked(self, fresh_db):
        """Analista aggiorna status='checked' dopo l'analisi."""
        db_path, tmp = fresh_db
        pos_id = insert_position(db_path, tmp, 'Dev Role', 'AnalCo')
        r = update_position(db_path, tmp, pos_id, status='checked')
        assert r.returncode == 0, f"db_update fallito:\n{r.stderr}"

        conn = sqlite3.connect(db_path)
        status = conn.execute("SELECT status FROM positions WHERE id=?", (pos_id,)).fetchone()[0]
        conn.close()
        assert status == 'checked'

    def test_analista_updates_status_to_excluded(self, fresh_db):
        """Analista può escludere una posizione (status='excluded')."""
        db_path, tmp = fresh_db
        pos_id = insert_position(db_path, tmp, 'Bad Role', 'BadCo')
        r = update_position(db_path, tmp, pos_id, status='excluded', notes='non pertinente')
        assert r.returncode == 0

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT status, notes FROM positions WHERE id=?", (pos_id,)).fetchone()
        conn.close()
        assert row[0] == 'excluded'
        assert 'non pertinente' in (row[1] or '')

    def test_analista_next_for_scorer_shows_checked(self, fresh_db):
        """next-for-scorer deve mostrare posizioni in status='checked'."""
        db_path, tmp = fresh_db
        pos_id = insert_position(db_path, tmp, 'Checked Role', 'CheckedCo')
        update_position(db_path, tmp, pos_id, status='checked')

        r = run_cli(DB_QUERY, ['next-for-scorer'], db_path, tmp)
        assert r.returncode == 0
        assert 'CheckedCo' in r.stdout or 'Checked Role' in r.stdout, \
            f"next-for-scorer non mostra posizioni checked.\nOutput: {r.stdout}"

    def test_analista_notes_saved(self, fresh_db):
        """Le note dell'analista devono essere salvate nel DB."""
        db_path, tmp = fresh_db
        pos_id = insert_position(db_path, tmp, 'Role', 'NoteCo')
        update_position(db_path, tmp, pos_id, status='checked',
                        notes='azienda interessante')

        conn = sqlite3.connect(db_path)
        notes = conn.execute("SELECT notes FROM positions WHERE id=?", (pos_id,)).fetchone()[0]
        conn.close()
        assert 'azienda interessante' in (notes or '')


# ---------------------------------------------------------------------------
# 3. Flusso Scorer
# ---------------------------------------------------------------------------

class TestScorerFlow:
    """Scorer assegna punteggio e porta le posizioni a 'scored'."""

    def _setup_checked(self, db_path, tmp, title='Scored Dev', company='ScorerCo'):
        pos_id = insert_position(db_path, tmp, title, company)
        update_position(db_path, tmp, pos_id, status='checked')
        return pos_id

    def test_scorer_inserts_score_record(self, fresh_db):
        """Scorer deve inserire un record in 'scores'."""
        db_path, tmp = fresh_db
        pos_id = self._setup_checked(db_path, tmp)
        r = insert_score(db_path, tmp, pos_id, total=78)
        assert r.returncode == 0, f"insert score fallito:\n{r.stderr}"

        conn = sqlite3.connect(db_path)
        score = conn.execute(
            "SELECT total_score FROM scores WHERE position_id=?", (pos_id,)
        ).fetchone()
        conn.close()
        assert score is not None, "Score non trovato in DB"
        assert score[0] == 78

    def test_scorer_updates_status_to_scored(self, fresh_db):
        """Dopo lo score, la posizione passa a 'scored'."""
        db_path, tmp = fresh_db
        pos_id = self._setup_checked(db_path, tmp)
        insert_score(db_path, tmp, pos_id, total=65)
        r = update_position(db_path, tmp, pos_id, status='scored')
        assert r.returncode == 0

        conn = sqlite3.connect(db_path)
        status = conn.execute("SELECT status FROM positions WHERE id=?", (pos_id,)).fetchone()[0]
        conn.close()
        assert status == 'scored'

    def test_scorer_next_for_scrittore_excludes_low_scores(self, fresh_db):
        """next-for-scrittore NON deve mostrare posizioni con score<50."""
        db_path, tmp = fresh_db

        # Score alto (75) → deve apparire
        id_high = self._setup_checked(db_path, tmp, 'High Score', 'HighCo')
        insert_score(db_path, tmp, id_high, total=75)
        update_position(db_path, tmp, id_high, status='scored')

        # Score basso (30) → non deve apparire
        id_low = self._setup_checked(db_path, tmp, 'Low Score', 'LowCo')
        insert_score(db_path, tmp, id_low, total=30)
        update_position(db_path, tmp, id_low, status='scored')

        r = run_cli(DB_QUERY, ['next-for-scrittore'], db_path, tmp)
        assert r.returncode == 0
        assert 'LowCo' not in r.stdout, \
            f"next-for-scrittore mostra posizioni con score<50.\nOutput: {r.stdout}"

    def test_scorer_next_for_scrittore_includes_high_scores(self, fresh_db):
        """next-for-scrittore deve includere posizioni con score>=50."""
        db_path, tmp = fresh_db
        pos_id = self._setup_checked(db_path, tmp, 'Good Role', 'GoodCo')
        insert_score(db_path, tmp, pos_id, total=70)
        update_position(db_path, tmp, pos_id, status='scored')

        r = run_cli(DB_QUERY, ['next-for-scrittore'], db_path, tmp)
        assert r.returncode == 0
        assert 'GoodCo' in r.stdout or 'Good Role' in r.stdout, \
            f"next-for-scrittore non mostra posizioni con score>=50.\nOutput: {r.stdout}"


# ---------------------------------------------------------------------------
# 4. Flusso Scrittore + Critico
# ---------------------------------------------------------------------------

class TestScrittoreCriticoFlow:
    """Scrittore crea applications, Critico porta a 'ready'."""

    def _setup_scored(self, db_path, tmp, title='Write Me Dev', company='WriteCo', total=80):
        pos_id = insert_position(db_path, tmp, title, company)
        update_position(db_path, tmp, pos_id, status='checked')
        insert_score(db_path, tmp, pos_id, total=total)
        update_position(db_path, tmp, pos_id, status='scored')
        return pos_id

    def test_scrittore_creates_application(self, fresh_db):
        """Scrittore inserisce un'application e porta a 'writing'."""
        db_path, tmp = fresh_db
        pos_id = self._setup_scored(db_path, tmp)

        r = run_cli(DB_INSERT, [
            'application', '--position-id', str(pos_id),
            '--cv-path', '/tmp/cv_test.md', '--cl-path', '/tmp/cl_test.md',
            '--written-by', 'scrittore-1',
        ], db_path, tmp)
        assert r.returncode == 0, f"insert application fallito:\n{r.stderr}"
        update_position(db_path, tmp, pos_id, status='writing')

        conn = sqlite3.connect(db_path)
        app = conn.execute(
            "SELECT a.written_by, p.status FROM applications a "
            "JOIN positions p ON p.id = a.position_id WHERE p.id=?",
            (pos_id,)
        ).fetchone()
        conn.close()
        assert app is not None, "Application non trovata"
        assert app[0] == 'scrittore-1'
        assert app[1] == 'writing'

    def test_critico_moves_to_review_then_ready(self, fresh_db):
        """Critico porta da 'review' a 'ready'."""
        db_path, tmp = fresh_db
        pos_id = self._setup_scored(db_path, tmp, 'Critico Dev', 'CriticoCo')
        run_cli(DB_INSERT, ['application', '--position-id', str(pos_id),
                             '--cv-path', '/tmp/cv.md', '--cl-path', '/tmp/cl.md'], db_path, tmp)
        update_position(db_path, tmp, pos_id, status='review')
        r = update_position(db_path, tmp, pos_id, status='ready')
        assert r.returncode == 0

        conn = sqlite3.connect(db_path)
        status = conn.execute("SELECT status FROM positions WHERE id=?", (pos_id,)).fetchone()[0]
        conn.close()
        assert status == 'ready'

    def test_next_for_critico_finds_review(self, fresh_db):
        """next-for-critico deve trovare posizioni con application in review."""
        db_path, tmp = fresh_db
        pos_id = self._setup_scored(db_path, tmp, 'Review Dev', 'ReviewCo')
        run_cli(DB_INSERT, ['application', '--position-id', str(pos_id),
                             '--cv-path', '/tmp/cv.md', '--cl-path', '/tmp/cl.md'], db_path, tmp)
        # Aggiorna ENTRAMBI: position status e application status (sono campi separati)
        update_position(db_path, tmp, pos_id, status='review')
        run_cli(DB_UPDATE, ['application', str(pos_id), '--status', 'review'], db_path, tmp)

        r = run_cli(DB_QUERY, ['next-for-critico'], db_path, tmp)
        assert r.returncode == 0
        assert 'ReviewCo' in r.stdout or 'Review Dev' in r.stdout, \
            f"next-for-critico non trova posizioni in review.\nOutput: {r.stdout}"

    def test_full_pipeline_flow(self, fresh_db):
        """Test E2E: new → checked → scored → writing → review → ready."""
        db_path, tmp = fresh_db

        # Scout
        pos_id = insert_position(db_path, tmp, 'Full Flow Dev', 'FlowCo')
        conn = sqlite3.connect(db_path)
        assert conn.execute("SELECT status FROM positions WHERE id=?", (pos_id,)).fetchone()[0] == 'new'
        conn.close()

        # Analista
        update_position(db_path, tmp, pos_id, status='checked')

        # Scorer
        insert_score(db_path, tmp, pos_id, total=82)
        update_position(db_path, tmp, pos_id, status='scored')

        # Scrittore
        run_cli(DB_INSERT, ['application', '--position-id', str(pos_id),
                             '--cv-path', '/tmp/cv.md', '--cl-path', '/tmp/cl.md',
                             '--written-by', 'scrittore-1'], db_path, tmp)
        update_position(db_path, tmp, pos_id, status='writing')
        update_position(db_path, tmp, pos_id, status='review')

        # Critico
        update_position(db_path, tmp, pos_id, status='ready')

        conn = sqlite3.connect(db_path)
        status = conn.execute("SELECT status FROM positions WHERE id=?", (pos_id,)).fetchone()[0]
        score = conn.execute("SELECT total_score FROM scores WHERE position_id=?", (pos_id,)).fetchone()[0]
        app = conn.execute("SELECT written_by FROM applications WHERE position_id=?", (pos_id,)).fetchone()
        conn.close()

        assert status == 'ready', f"Status finale atteso 'ready', trovato '{status}'"
        assert score == 82
        assert app is not None and app[0] == 'scrittore-1'


# ---------------------------------------------------------------------------
# 5. Scout Coordination
# ---------------------------------------------------------------------------

class TestScoutCoordination:
    """scout_coord.py gestisce la distribuzione del lavoro tra scout."""

    def test_scout_assign_records_in_db(self, tmp_path):
        """scout_coord assign deve registrare la distribuzione nel DB."""
        coord_db = str(tmp_path / 'coord.db')
        # Usa importlib per caricare il modulo, poi patchare DB_PATH
        # (exec() crea un nuovo namespace dove DB_PATH = Path(...) override ogni pre-patch)
        wrapper = tmp_path / '_coord_wrapper.py'
        wrapper.write_text(f"""
import sys, pathlib, importlib.util
sys.path.insert(0, {repr(SKILLS_DIR)})

spec = importlib.util.spec_from_file_location("scout_coord", {repr(SCOUT_COORD)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.DB_PATH = pathlib.Path({repr(coord_db)})  # patch DOPO il caricamento

mod.cmd_assign('scout-1', cerchi='1,2', fonti='remoteok')
print("OK")
""")
        r = subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)
        assert r.returncode == 0, f"scout_coord assign fallito:\n{r.stderr}\n{r.stdout}"

        conn = sqlite3.connect(coord_db)
        row = conn.execute(
            "SELECT scout, cerchi, fonti FROM coordination WHERE superseded_at IS NULL"
        ).fetchone()
        conn.close()
        assert row is not None, "Nessuna distribuzione registrata"
        assert row[0] == 'scout-1'
        assert '1,2' in (row[1] or '')

    def test_scout_claim_prevents_collision(self, tmp_path):
        """Due scout non devono claimare lo stesso job_id."""
        coord_db = str(tmp_path / 'coord_claim.db')

        def run_coord(job_id, scout_name, suffix):
            wrapper = tmp_path / f'_claim_{suffix}.py'
            wrapper.write_text(f"""
import sys, pathlib, importlib.util
sys.path.insert(0, {repr(SKILLS_DIR)})

spec = importlib.util.spec_from_file_location("scout_coord_{suffix}", {repr(SCOUT_COORD)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.DB_PATH = pathlib.Path({repr(coord_db)})

mod.cmd_claim({repr(job_id)}, {repr(scout_name)})
""")
            return subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)

        # Scout-1 claima job 42
        r1 = run_coord('42', 'scout-1', '1')
        assert r1.returncode == 0, f"claim scout-1 fallito:\n{r1.stderr}"
        # Scout-2 prova a claimare lo stesso job 42
        r2 = run_coord('42', 'scout-2', '2')

        conn = sqlite3.connect(coord_db)
        claim = conn.execute("SELECT scout FROM claims WHERE job_id='42'").fetchone()
        conn.close()

        assert claim is not None
        assert claim[0] == 'scout-1', f"Il claim è stato sovrascritto da scout-2. Scout attuale: {claim[0]}"


# ---------------------------------------------------------------------------
# 6. CLAUDE.md Agenti — verifica presenza (xfail finché non migrati)
# ---------------------------------------------------------------------------

# Agenti dal legacy ~/Repos/job-hunter/ + sentinella aggiunta da Leone
# Fonte: ls ~/Repos/job-hunter/ + ordine CEO
EXPECTED_AGENTS = [
    'capitano',        # Capitano
    'scout',       # Scout (+ scout-1/2/3 in legacy)
    'analista',    # Analista (+ analista-1/2 in legacy)
    'scorer',      # Scorer (+ scorer-1/2/3 in legacy)
    'scrittore',   # Scrittore (+ scrittore-1/2/3 in legacy)
    'critico',     # Critico
    'sentinella',  # Sentinella (rate limit, richiesta da Leone)
]


class TestAgentClaudeMd:
    """
    Le directory agenti JOB HUNTER devono essere presenti sotto agents/<agent>/.
    I CLAUDE.md NON sono committati (copiati dal legacy al lancio via start-agent.sh).

    agents/<agent>/ → PASS (directories esistono con .gitkeep)
    agents/<agent>/CLAUDE.md → XFAIL (non committato, copiato al runtime)
    """

    def test_agents_directory_exists(self):
        """La directory agents/ deve esistere nella repo."""
        assert os.path.isdir(AGENTS_DIR), \
            f"agents/ mancante in {REPO_ROOT}"

    @pytest.mark.parametrize("agent", EXPECTED_AGENTS)
    def test_agent_directory_exists(self, agent):
        """Ogni agente deve avere la sua directory in agents/<agent>/."""
        path = os.path.join(AGENTS_DIR, agent)
        assert os.path.isdir(path), \
            f"agents/{agent}/ mancante — directory agente non creata"

    @pytest.mark.parametrize("agent", EXPECTED_AGENTS)
    @pytest.mark.xfail(
        strict=False,
        reason="CLAUDE.md non committato — copiato da ~/Repos/job-hunter/ al lancio via start-agent.sh (PR #10)"
    )
    def test_agent_claudemd_exists(self, agent):
        """XFAIL: CLAUDE.md non è committato nella repo (copiato al runtime)."""
        path = os.path.join(AGENTS_DIR, agent, 'CLAUDE.md')
        assert os.path.isfile(path), \
            f"agents/{agent}/CLAUDE.md mancante (atteso: non committato)"


# ---------------------------------------------------------------------------
# 7. Rate Limit Sentinel
# ---------------------------------------------------------------------------

has_sentinel = os.path.isfile(RATE_SENTINEL)
requires_sentinel = pytest.mark.skipif(
    not has_sentinel,
    reason="rate_sentinel.py non ancora mergiato in questo worktree (PR backend in corso)"
)


class TestRateSentinel:
    """
    rate_sentinel.py monitora il consumo Claude degli agenti JH.
    Non monitora le sessioni dev team (JHT-QA, JHT-BACKEND, ecc.).
    """

    @requires_sentinel
    def test_sentinel_status_runs(self, tmp_path):
        """--status deve girare senza errori."""
        wrapper = tmp_path / '_sentinel_status.py'
        wrapper.write_text(f"""
import sys
sys.argv = ['rate_sentinel.py', '--status']
with open({repr(RATE_SENTINEL)}) as _f:
    exec(compile(_f.read(), {repr(RATE_SENTINEL)}, 'exec'),
         {{'__file__': {repr(RATE_SENTINEL)}, '__name__': '__main__'}})
""")
        r = subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)
        assert r.returncode == 0, f"rate_sentinel --status fallito:\n{r.stderr}"
        assert 'SENTINELLA' in r.stdout or 'Rate' in r.stdout, \
            f"Output --status non contiene dati attesi:\n{r.stdout}"

    @requires_sentinel
    def test_sentinel_reset_runs(self, tmp_path):
        """--reset deve girare senza errori."""
        wrapper = tmp_path / '_sentinel_reset.py'
        wrapper.write_text(f"""
import sys
sys.argv = ['rate_sentinel.py', '--reset']
with open({repr(RATE_SENTINEL)}) as _f:
    exec(compile(_f.read(), {repr(RATE_SENTINEL)}, 'exec'),
         {{'__file__': {repr(RATE_SENTINEL)}, '__name__': '__main__'}})
""")
        r = subprocess.run([sys.executable, str(wrapper)], capture_output=True, text=True)
        assert r.returncode == 0, f"rate_sentinel --reset fallito:\n{r.stderr}"

    @requires_sentinel
    def test_sentinel_excludes_dev_sessions(self):
        """DEV_SESSIONS deve includere tutte le sessioni dev (non agenti JH)."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("rate_sentinel", RATE_SENTINEL)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        # Sessioni dev devono essere escluse
        for dev_session in ['JHT-QA', 'JHT-BACKEND', 'JHT-FRONTEND', 'JHT-E2E', 'JHT-INFRA']:
            assert dev_session in mod.DEV_SESSIONS, \
                f"Sessione dev {dev_session} non in DEV_SESSIONS — potrebbe monitorare dev team"

        # Prefissi agenti JH devono essere presenti (PR #20: rinominato da JH_AGENT_SESSIONS a JH_AGENT_PREFIXES)
        for prefix in ['CAPITANO', 'SCOUT', 'ANALISTA', 'SCORER', 'SCRITTORE', 'CRITICO', 'SENTINELLA']:
            assert prefix in mod.JH_AGENT_PREFIXES, \
                f"Prefisso agente '{prefix}' non in JH_AGENT_PREFIXES"

    @requires_sentinel
    def test_sentinel_thresholds(self):
        """WARNING=70%, CRITICAL=90%."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("rate_sentinel", RATE_SENTINEL)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.WARNING_PCT == 70, f"WARNING_PCT atteso 70, trovato {mod.WARNING_PCT}"
        assert mod.CRITICAL_PCT == 90, f"CRITICAL_PCT atteso 90, trovato {mod.CRITICAL_PCT}"

    @requires_sentinel
    def test_sentinel_state_load_save(self, tmp_path):
        """load_state() e save_state() devono funzionare correttamente."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("rate_sentinel", RATE_SENTINEL)
        mod = importlib.util.module_from_spec(spec)
        # Patcha DATA_DIR prima di caricare il modulo
        spec.loader.exec_module(mod)
        mod.STATE_FILE = tmp_path / 'test_state.json'
        mod.DATA_DIR = tmp_path

        state = mod.load_state()
        assert state['messages_total'] == 0
        assert state['messages_hourly'] == 0
        assert state['messages_daily'] == 0

        state['messages_total'] = 42
        mod.save_state(state)

        state2 = mod.load_state()
        assert state2['messages_total'] == 42, \
            "save_state/load_state non persistono i dati correttamente"

    @requires_sentinel
    def test_sentinel_check_thresholds_no_warning_below_70pct(self, tmp_path):
        """check_thresholds non deve inviare warning sotto 70%."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("rate_sentinel", RATE_SENTINEL)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.DATA_DIR = tmp_path
        mod.LOG_FILE = tmp_path / 'test.log'

        state = mod.load_state()
        # Sotto soglia warning (60%)
        state = mod.check_thresholds(
            state, max_pct=60, hourly_pct=60, daily_pct=40,
            rate_per_min=1.0, hours_to_limit=10.0, eta_limit=None, sessions=[]
        )
        assert state['warnings_sent'] == 0, \
            "Sentinel ha inviato warning sotto soglia 70%"
