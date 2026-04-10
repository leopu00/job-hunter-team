import Database from 'better-sqlite3'
import fs from 'fs'
import { JHT_DB_PATH } from '@/lib/jht-paths'

declare const globalThis: { __jht_db_cache?: { path: string; db: Database.Database } }

export function getDb(_workspacePath?: string): Database.Database {
  const dbPath = JHT_DB_PATH
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database non trovato: ${dbPath}`)
  }

  const cached = globalThis.__jht_db_cache
  if (cached?.path === dbPath && cached?.db?.open) {
    return cached.db
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  globalThis.__jht_db_cache = { path: dbPath, db }
  return db
}

const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);

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

CREATE INDEX IF NOT EXISTS idx_scores_total ON scores(total_score);

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

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

PRAGMA user_version = 2;
`

export function initDb(_workspacePath?: string): void {
  const db = new Database(JHT_DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  db.close()
}
