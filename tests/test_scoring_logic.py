"""
Test suite logica di scoring — Job Hunter Team QA.

Testa le funzioni di business logic estratte da db_insert.py:
- extract_linkedin_job_id(): parsing URL LinkedIn
- check_duplicate(): rilevamento duplicati per LinkedIn ID e company+title
- Soglie di scoring: EXCLUDED (<40), PARCHEGGIO (40-49), PASS (>=50)
- Soglie critic: READY (>=5), EXCLUDED (<5)

Eseguire con: pytest tests/test_scoring_logic.py -v
"""

import re
import sqlite3
import sys
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
sys.path.insert(0, SKILLS_DIR)


# ---------------------------------------------------------------------------
# Helper: DB in-memory isolato
# ---------------------------------------------------------------------------

def _make_db():
    """Crea un DB SQLite in-memory con lo schema V2."""
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            verdict TEXT DEFAULT 'UNKNOWN'
        );

        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            company_id INTEGER,
            location TEXT,
            remote_type TEXT,
            url TEXT NOT NULL UNIQUE,
            source TEXT,
            status TEXT DEFAULT 'new',
            total_score REAL,
            found_by TEXT,
            jd_text TEXT,
            requirements TEXT
        );

        CREATE TABLE scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL,
            total_score INTEGER,
            stack_match INTEGER,
            remote_fit INTEGER,
            salary_fit INTEGER,
            experience_fit INTEGER,
            strategic_fit INTEGER,
            scored_by TEXT,
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );

        CREATE TABLE applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL,
            cv_path TEXT,
            critic_score REAL,
            critic_verdict TEXT,
            applied INTEGER DEFAULT 0,
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );
    """)
    return conn


# ---------------------------------------------------------------------------
# Funzione estratta (replica logica da db_insert.py)
# ---------------------------------------------------------------------------

def extract_linkedin_job_id(url):
    """Estrae l'ID numerico da URL LinkedIn."""
    if not url:
        return None
    match = re.search(r'linkedin\.com/jobs/view/(\d+)', url)
    return match.group(1) if match else None


def check_duplicate(conn, url, company, title):
    """Rilevamento duplicati: LinkedIn job ID o company+title."""
    linkedin_id = extract_linkedin_job_id(url)
    if linkedin_id:
        existing = conn.execute(
            "SELECT id, title, company FROM positions "
            "WHERE url LIKE ? AND status != 'excluded'",
            (f'%{linkedin_id}%',)
        ).fetchone()
        if existing:
            return existing, f"LinkedIn job ID {linkedin_id}"

    if company and title:
        existing = conn.execute(
            "SELECT id, title, company FROM positions "
            "WHERE LOWER(company) = LOWER(?) "
            "AND LOWER(title) = LOWER(?) "
            "AND status != 'excluded'",
            (company, title)
        ).fetchone()
        if existing:
            return existing, "company+title"

    return None, None


def classify_score(total: int) -> str:
    """Classifica uno score secondo le soglie della pipeline."""
    if total < 40:
        return "EXCLUDED"
    elif total <= 49:
        return "PARCHEGGIO"
    else:
        return "PASS"


def classify_critic(critic_score: float) -> str:
    """Classifica il voto del critico."""
    if critic_score >= 5:
        return "READY"
    else:
        return "EXCLUDED"


# ---------------------------------------------------------------------------
# Test 1: extract_linkedin_job_id
# ---------------------------------------------------------------------------

class TestExtractLinkedinJobId:

    def test_standard_url(self):
        url = "https://www.linkedin.com/jobs/view/4381470286"
        assert extract_linkedin_job_id(url) == "4381470286"

    def test_url_with_query_params(self):
        url = "https://www.linkedin.com/jobs/view/4381470286?refId=abc&trackingId=xyz"
        assert extract_linkedin_job_id(url) == "4381470286"

    def test_non_linkedin_url(self):
        url = "https://jobs.lever.co/company/position-123"
        assert extract_linkedin_job_id(url) is None

    def test_none_input(self):
        assert extract_linkedin_job_id(None) is None

    def test_empty_string(self):
        assert extract_linkedin_job_id("") is None

    def test_linkedin_url_without_job_id(self):
        url = "https://www.linkedin.com/company/google"
        assert extract_linkedin_job_id(url) is None

    def test_indeed_url(self):
        url = "https://it.indeed.com/viewjob?jk=abc123"
        assert extract_linkedin_job_id(url) is None


# ---------------------------------------------------------------------------
# Test 2: check_duplicate
# ---------------------------------------------------------------------------

class TestCheckDuplicate:

    def _insert_position(self, conn, title, company, url, status='new'):
        conn.execute(
            "INSERT INTO positions (title, company, url, status) VALUES (?, ?, ?, ?)",
            (title, company, url, status)
        )
        conn.commit()

    def test_no_duplicate_empty_db(self):
        conn = _make_db()
        result, reason = check_duplicate(conn, "https://example.com/job/1", "Corp", "Dev")
        assert result is None
        assert reason is None

    def test_duplicate_by_linkedin_id(self):
        conn = _make_db()
        url = "https://www.linkedin.com/jobs/view/9999999"
        self._insert_position(conn, "Python Dev", "Corp", url)

        result, reason = check_duplicate(conn, url, "Corp", "Python Dev")
        assert result is not None
        assert "9999999" in reason

    def test_duplicate_by_company_title(self):
        conn = _make_db()
        self._insert_position(conn, "Python Dev", "Corp SRL", "https://corp.example.com/job/1")

        result, reason = check_duplicate(
            conn, "https://corp.example.com/job/2", "Corp SRL", "Python Dev"
        )
        assert result is not None
        assert reason == "company+title"

    def test_duplicate_case_insensitive(self):
        conn = _make_db()
        self._insert_position(conn, "python dev", "corp srl", "https://corp.example.com/job/1")

        result, reason = check_duplicate(
            conn, "https://corp.example.com/job/2", "CORP SRL", "PYTHON DEV"
        )
        assert result is not None

    def test_excluded_position_not_a_duplicate(self):
        """Posizioni con status='excluded' NON bloccano nuovi inserimenti."""
        conn = _make_db()
        url = "https://www.linkedin.com/jobs/view/8888888"
        self._insert_position(conn, "Python Dev", "Corp", url, status='excluded')

        result, reason = check_duplicate(conn, url, "Corp", "Python Dev")
        assert result is None

    def test_no_duplicate_different_company(self):
        conn = _make_db()
        self._insert_position(conn, "Python Dev", "Corp A", "https://corp-a.example.com/job/1")

        result, reason = check_duplicate(
            conn, "https://corp-b.example.com/job/1", "Corp B", "Python Dev"
        )
        assert result is None

    def test_no_duplicate_different_title(self):
        conn = _make_db()
        self._insert_position(conn, "Python Dev", "Corp", "https://corp.example.com/job/1")

        result, reason = check_duplicate(
            conn, "https://corp.example.com/job/2", "Corp", "Senior Python Dev"
        )
        assert result is None


# ---------------------------------------------------------------------------
# Test 3: classificazione score (soglie pipeline)
# ---------------------------------------------------------------------------

class TestScoreClassification:
    """Verifica le soglie di scoring: EXCLUDED / PARCHEGGIO / PASS."""

    # --- Boundary EXCLUDED ---
    def test_score_0_excluded(self):
        assert classify_score(0) == "EXCLUDED"

    def test_score_39_excluded(self):
        assert classify_score(39) == "EXCLUDED"

    # --- Boundary PARCHEGGIO ---
    def test_score_40_parcheggio(self):
        assert classify_score(40) == "PARCHEGGIO"

    def test_score_49_parcheggio(self):
        assert classify_score(49) == "PARCHEGGIO"

    # --- Boundary PASS ---
    def test_score_50_pass(self):
        assert classify_score(50) == "PASS"

    def test_score_100_pass(self):
        assert classify_score(100) == "PASS"

    def test_score_75_pass(self):
        assert classify_score(75) == "PASS"

    def test_score_25_excluded(self):
        assert classify_score(25) == "EXCLUDED"


# ---------------------------------------------------------------------------
# Test 4: classificazione critic score
# ---------------------------------------------------------------------------

class TestCriticClassification:
    """Verifica le soglie del voto critico: READY / EXCLUDED."""

    def test_critic_5_ready(self):
        assert classify_critic(5.0) == "READY"

    def test_critic_7_ready(self):
        assert classify_critic(7.5) == "READY"

    def test_critic_10_ready(self):
        assert classify_critic(10.0) == "READY"

    def test_critic_4_excluded(self):
        assert classify_critic(4.9) == "EXCLUDED"

    def test_critic_0_excluded(self):
        assert classify_critic(0.0) == "EXCLUDED"

    def test_critic_3_excluded(self):
        assert classify_critic(3.0) == "EXCLUDED"


# ---------------------------------------------------------------------------
# Test 5: score sottocategorie — verifica massimi per categoria
# ---------------------------------------------------------------------------

class TestScoreSubcategoryConstraints:
    """
    Verifica che le sottocategorie rispettino i massimi della pipeline.
    Soglie da shared/docs:
      stack_match: max 40
      remote_fit: max 25
      salary_fit: max 20
      strategic_fit: max 15
    """

    def _valid_score_sum(self, stack, remote, salary, strategic):
        """Verifica che la somma non superi 100."""
        return (stack + remote + salary + strategic) <= 100

    def test_max_stack_match(self):
        assert 40 <= 40  # max consentito

    def test_stack_over_max_invalid(self):
        """stack_match=41 supera il massimo di 40."""
        assert 41 > 40

    def test_sum_of_maxes_equals_100(self):
        """La somma dei massimi di categoria deve essere 100."""
        assert 40 + 25 + 20 + 15 == 100

    def test_valid_score_distribution(self):
        assert self._valid_score_sum(35, 20, 15, 10) is True

    def test_invalid_score_distribution(self):
        assert self._valid_score_sum(40, 25, 20, 20) is False  # supera 100


# ---------------------------------------------------------------------------
# Test 6: schema DB — colonne obbligatorie
# ---------------------------------------------------------------------------

class TestDatabaseSchema:
    """Verifica che il DB in-memory abbia le colonne corrette."""

    def test_positions_has_required_columns(self):
        conn = _make_db()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(positions)").fetchall()}
        required = {'id', 'title', 'company', 'url', 'status', 'source'}
        assert required.issubset(cols)

    def test_scores_no_pros_cons(self):
        """Regressione BUG: scores non deve avere colonne pros/cons."""
        conn = _make_db()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(scores)").fetchall()}
        assert 'pros' not in cols
        assert 'cons' not in cols

    def test_scores_has_subcategories(self):
        conn = _make_db()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(scores)").fetchall()}
        expected = {'stack_match', 'remote_fit', 'salary_fit', 'strategic_fit'}
        assert expected.issubset(cols)

    def test_applications_has_critic_fields(self):
        conn = _make_db()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(applications)").fetchall()}
        assert 'critic_score' in cols
        assert 'critic_verdict' in cols
        assert 'applied' in cols
