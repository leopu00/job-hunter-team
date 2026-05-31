import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { JHT_DB_PATH } from '@/lib/jht-paths'

declare const globalThis: { __jht_db_cache?: { path: string; sourceMtimeMs: number; db: Database.Database } }

// Docker Desktop bind-mount workaround (Windows): quando il container Linux
// scrive su /jht_home/jobs.db e l'host Windows legge lo stesso file via
// virtiofs/9P, better-sqlite3 ottiene SQLITE_IOERR_SHORT_READ durante pread()
// concorrenti alle scritture, restituendo snapshot stantii (es. "25 posizioni"
// invece di 36). Copiamo jobs.db + WAL + SHM su path Windows nativo prima di
// aprirli: la lettura cross-FS avviene una sola volta tramite fs.copyFileSync
// (che fa un read() pieno, non pread), poi SQLite legge da NTFS senza
// ambiguita'.
function resolveReadablePath(): { dbPath: string; sourceMtimeMs: number } {
  const srcStat = fs.statSync(JHT_DB_PATH)
  if (process.platform !== 'win32') {
    return { dbPath: JHT_DB_PATH, sourceMtimeMs: srcStat.mtimeMs }
  }
  const cacheDir = path.join(os.tmpdir(), 'jht-web-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const dbPath = path.join(cacheDir, 'jobs.db')
  const walPath = dbPath + '-wal'
  const shmPath = dbPath + '-shm'

  let needsCopy = true
  try {
    const dstStat = fs.statSync(dbPath)
    if (dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size === srcStat.size) needsCopy = false
  } catch { /* missing */ }

  if (needsCopy) {
    fs.copyFileSync(JHT_DB_PATH, dbPath)
    // WAL/SHM possono non esistere (DB checkpointato a fondo); copiarli
    // se presenti assicura che SQLite veda anche i commit post-checkpoint.
    // Se spariti dopo la checkpoint nel container, rimuoviamo i vecchi
    // nella cache per evitare di leggere WAL scollegata dal main DB.
    for (const [src, dst] of [[JHT_DB_PATH + '-wal', walPath], [JHT_DB_PATH + '-shm', shmPath]]) {
      try {
        if (fs.existsSync(src)) fs.copyFileSync(src, dst)
        else if (fs.existsSync(dst)) fs.unlinkSync(dst)
      } catch { /* best effort */ }
    }
  }
  return { dbPath, sourceMtimeMs: srcStat.mtimeMs }
}

export function getDb(_workspacePath?: string): Database.Database {
  if (!fs.existsSync(JHT_DB_PATH)) {
    throw new Error(`Database non trovato: ${JHT_DB_PATH}`)
  }
  const { dbPath, sourceMtimeMs } = resolveReadablePath()

  const cached = globalThis.__jht_db_cache
  if (cached?.path === dbPath && cached?.sourceMtimeMs === sourceMtimeMs && cached?.db?.open) {
    return cached.db
  }
  if (cached?.db?.open) { try { cached.db.close() } catch { /* ignore */ } }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  globalThis.__jht_db_cache = { path: dbPath, sourceMtimeMs, db }
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
  verdict TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  role_family TEXT,
  write_requested INTEGER DEFAULT 0,
  write_requested_at TIMESTAMP,
  geocode_requested INTEGER DEFAULT 0,
  geocode_requested_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
CREATE INDEX IF NOT EXISTS idx_positions_role_family ON positions(role_family) WHERE role_family IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_positions_write_requested ON positions(write_requested) WHERE write_requested = 1;
CREATE INDEX IF NOT EXISTS idx_positions_geocode_requested ON positions(geocode_requested) WHERE geocode_requested = 1;

CREATE TABLE IF NOT EXISTS position_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS pending_user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notification' CHECK (kind IN (
    'notification','question','digest','alert'
  )),
  related_position_id INTEGER,
  delivered_via TEXT CHECK (delivered_via IN ('telegram','web') OR delivered_via IS NULL),
  delivered_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  user_reply TEXT,
  user_reply_at TIMESTAMP,
  agent_seen_reply_at TIMESTAMP,
  cloud_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (related_position_id) REFERENCES positions(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_agent ON pending_user_messages(agent);
CREATE INDEX IF NOT EXISTS idx_pending_user_messages_delivery ON pending_user_messages(delivered_via, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_pending_user_messages_unseen_reply ON pending_user_messages(user_reply_at, agent_seen_reply_at);

-- Touch trigger su tutte le tabelle: aggiorna updated_at quando una UPDATE
-- non lo tocca esplicitamente. La WHEN-clause evita la ricorsione
-- (l'UPDATE del trigger stesso fa cambiare NEW.updated_at, quindi non
-- rientra). Allineato a shared/skills/_db.py (single source of truth).
CREATE TRIGGER IF NOT EXISTS companies_touch_updated_at
AFTER UPDATE ON companies FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE companies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS positions_touch_updated_at
AFTER UPDATE ON positions FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE positions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS position_highlights_touch_updated_at
AFTER UPDATE ON position_highlights FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE position_highlights SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS scores_touch_updated_at
AFTER UPDATE ON scores FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE scores SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS applications_touch_updated_at
AFTER UPDATE ON applications FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE applications SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS pending_user_messages_touch_updated_at
AFTER UPDATE ON pending_user_messages FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE pending_user_messages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

PRAGMA user_version = 5;
`

export function initDb(_workspacePath?: string): void {
  const db = new Database(JHT_DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  db.close()
}
