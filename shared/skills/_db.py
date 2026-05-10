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
    """Crea le tabelle se non esistono (schema V3).

    La migrazione retroattiva v2→v3 (CHECK su positions.status) viene
    eseguita PRIMA del CREATE TABLE IF NOT EXISTS, così i CREATE TRIGGER
    IF NOT EXISTS più sotto ricreano i trigger anti-'now' che il DROP
    TABLE della migrazione butta via insieme ai loro vincoli.
    """
    _migrate_v2_to_v3(conn)
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
        status TEXT DEFAULT 'new' CHECK (status IN (
            'new','checked','scored','writing','ready','applied','response','excluded'
        )),
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

    -- Trigger educativi: rifiutano la stringa letterale 'now' nei timestamp
    -- e suggeriscono il pattern corretto. Audit 2026-05-02 mostro' 8 record
    -- con written_at='now' (stringa di 3 caratteri) finiti nel DB perche'
    -- gli Scrittori facevano INSERT inline via `python3 -c "import sqlite3
    -- ... VALUES (..., 'now', ...)"` invece di chiamare la skill UPSERT
    -- (db_update.py application). Un fix silenzioso (UPDATE auto a ISO)
    -- avrebbe mascherato l'anti-pattern; preferiamo RAISE(ABORT) con un
    -- messaggio che insegna come fare. INSERT/UPDATE legittimi (via skill
    -- o con datetime('now','localtime') inline) passano: i trigger
    -- valutano NEW.<col> dopo che le espressioni SQL sono gia' state
    -- valutate, quindi il valore visto e' l'ISO timestamp, non 'now'.
    CREATE TRIGGER IF NOT EXISTS applications_reject_str_now_insert
    BEFORE INSERT ON applications
    WHEN NEW.written_at = 'now' OR NEW.applied_at = 'now' OR NEW.response_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" come written_at/applied_at/response_at. USA: python3 /app/shared/skills/db_update.py application <POSITION_ID> ... (la skill UPSERT converte automaticamente). NON fare INSERT inline via python3 -c "import sqlite3 ... VALUES (..., now, ...)". Vedi REGOLA-11b nel tuo prompt.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS applications_reject_str_now_update
    BEFORE UPDATE ON applications
    WHEN NEW.written_at = 'now' OR NEW.applied_at = 'now' OR NEW.response_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" in UPDATE. USA: python3 /app/shared/skills/db_update.py application <POSITION_ID> --written-at now (la skill converte) oppure datetime("now","localtime") in SQL inline.'
      );
    END;

    -- Stessa protezione per positions (found_at, last_checked) e companies
    -- (analyzed_at). Anti-pattern atteso: Scout/Analista che fanno INSERT
    -- inline e passano 'now' invece di datetime('now','localtime'). Skill
    -- canoniche da usare: db_update.py position --last-checked now (gia'
    -- gestita), insert via skill di scout/analista che usano CURRENT_TIMESTAMP.
    CREATE TRIGGER IF NOT EXISTS positions_reject_str_now_insert
    BEFORE INSERT ON positions
    WHEN NEW.found_at = 'now' OR NEW.last_checked = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" come found_at/last_checked di positions. USA: db_update.py position <ID> --last-checked now (converte) oppure datetime("now","localtime") in SQL inline. NON passare la stringa "now" letterale.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS positions_reject_str_now_update
    BEFORE UPDATE ON positions
    WHEN NEW.found_at = 'now' OR NEW.last_checked = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" in UPDATE positions. USA: db_update.py position <ID> --last-checked now oppure datetime("now","localtime") in SQL inline.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS companies_reject_str_now_insert
    BEFORE INSERT ON companies
    WHEN NEW.analyzed_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" come analyzed_at di companies. USA: db_update.py company "<name>" ... (la skill imposta CURRENT_TIMESTAMP) oppure datetime("now","localtime") in SQL inline.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS companies_reject_str_now_update
    BEFORE UPDATE ON companies
    WHEN NEW.analyzed_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'TIMESTAMP NON VALIDO: hai passato la stringa "now" in UPDATE companies. USA: db_update.py company oppure datetime("now","localtime") in SQL inline.'
      );
    END;
    """)
    conn.execute("PRAGMA user_version = 3")
    conn.commit()


def _migrate_v2_to_v3(conn: sqlite3.Connection) -> None:
    """Aggiunge CHECK su positions.status per DB già su user_version 2.

    SQLite non supporta `ALTER TABLE ADD CHECK`: serve il rituale
    create-new + copy + drop + rename. Eseguito solo se la versione
    sul disco è esattamente 2 (DB nuovi finiscono già a 3 via il
    CREATE TABLE qui sopra; DB più vecchi non sono mai esistiti in
    produzione).

    Idempotente: se positions ha già il CHECK, l'INSERT passa e la
    rename ha lo stesso schema → operazione no-op semantica. Se un
    valore non-canonico fosse presente, l'INSERT fallirebbe; in tal
    caso meglio fail-fast che corruzione silenziosa.
    """
    current_version = conn.execute("PRAGMA user_version").fetchone()[0]
    if current_version != 2:
        return

    schema_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'"
    ).fetchone()
    if schema_row:
        # Marker preciso: la stringa "check(statusin" (whitespace strip + upper)
        # è univoca al CHECK constraint che vogliamo. Una guard naive su 'CHECK'
        # falsa-positivava sulla colonna `last_checked`.
        sql_norm = ''.join((schema_row['sql'] or '').upper().split())
        if 'CHECK(STATUSIN' in sql_norm:
            return  # già migrato (es. DB ricreato da un client più recente)

    conn.executescript("""
        CREATE TABLE positions_new (
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
            status TEXT DEFAULT 'new' CHECK (status IN (
                'new','checked','scored','writing','ready','applied','response','excluded'
            )),
            notes TEXT,
            last_checked TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        INSERT INTO positions_new SELECT * FROM positions;
        DROP TABLE positions;
        ALTER TABLE positions_new RENAME TO positions;

        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
        CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
        CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);
        CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
    """)


def resolve_company_id(conn: sqlite3.Connection, company_name: str):
    """Cerca company_id per nome (case-insensitive). Ritorna ID o None."""
    if not company_name:
        return None
    row = conn.execute(
        "SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", (company_name,)
    ).fetchone()
    return row['id'] if row else None
