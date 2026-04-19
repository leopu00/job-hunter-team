"""Modulo DB condiviso — connessione e schema V2 per jobs.db"""

import sqlite3
import os

# Path DB unico, coerente con tutto il resto dell'app JHT:
#   1. $JHT_DB esplicito (prima scelta) — dashboard web, API routes e
#      start-agent.sh impostano questa env var su $JHT_HOME/jobs.db
#   2. $JHT_HOME/jobs.db quando JHT_HOME è noto
#   3. path relativo allo script (fallback storico per esecuzioni
#      ad-hoc fuori dal container JHT)
# Prima c'era solo (3): script invocati da /jht_home/agents/shared/skills/
# scrivevano in /jht_home/agents/shared/data/jobs.db, mentre la dashboard
# web leggeva $JHT_HOME/jobs.db → due DB non in sync, posizioni inserite
# dagli agenti invisibili alla UI.
def _resolve_db_path() -> str:
    env_db = os.environ.get('JHT_DB')
    if env_db:
        return env_db
    jht_home = os.environ.get('JHT_HOME')
    if jht_home:
        return os.path.join(jht_home, 'jobs.db')
    return os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs.db')


DB_PATH = _resolve_db_path()


def get_db() -> sqlite3.Connection:
    """Restituisce connessione al database con WAL mode e foreign keys."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection):
    """Crea le tabelle se non esistono (schema V2)."""
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        website TEXT,
        hq_country TEXT,
        sector TEXT,
        size TEXT,
        glassdoor_rating REAL,
        red_flags TEXT,
        culture_notes TEXT,
        analyzed_by TEXT,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verdict TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        company_id INTEGER,
        location TEXT,
        remote_type TEXT,
        salary_declared_min INTEGER,
        salary_declared_max INTEGER,
        salary_declared_currency TEXT DEFAULT 'EUR',
        salary_estimated_min INTEGER,
        salary_estimated_max INTEGER,
        salary_estimated_currency TEXT DEFAULT 'EUR',
        salary_estimated_source TEXT,
        url TEXT,
        source TEXT,
        jd_text TEXT,
        requirements TEXT,
        found_by TEXT,
        found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deadline TEXT,
        status TEXT DEFAULT 'new',
        notes TEXT,
        last_checked TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS position_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

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
        scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        cv_path TEXT,
        cl_path TEXT,
        cv_pdf_path TEXT,
        cl_pdf_path TEXT,
        critic_verdict TEXT,
        critic_score REAL,
        critic_notes TEXT,
        status TEXT DEFAULT 'draft',
        written_at TIMESTAMP,
        applied_at TIMESTAMP,
        applied_via TEXT,
        response TEXT,
        response_at TIMESTAMP,
        written_by TEXT,
        reviewed_by TEXT,
        critic_reviewed_at TIMESTAMP,
        applied BOOLEAN DEFAULT 0,
        interview_round INTEGER DEFAULT NULL,
        cv_drive_id TEXT,
        cl_drive_id TEXT,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
    CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);
    CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
    CREATE INDEX IF NOT EXISTS idx_scores_total ON scores(total_score);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    """)
    conn.execute("PRAGMA user_version = 2")
    conn.commit()


def resolve_company_id(conn: sqlite3.Connection, company_name: str):
    """Cerca company_id per nome (case-insensitive). Ritorna ID o None."""
    if not company_name:
        return None
    row = conn.execute(
        "SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", (company_name,)
    ).fetchone()
    return row['id'] if row else None
