// One-shot seeder: legge i dump JSON estratti via MCP da Supabase
// (positions / scores / applications per l'utente loggato) e li
// scrive in ~/.jht/jobs.db così la dashboard locale del web ha dati
// veri da renderizzare durante il lavoro grafico.
//
// Workflow:
//   1. Estrai dati via MCP execute_sql (già fatto, file in tool-results/).
//   2. Lancia: cd web && node scripts/seed-from-supabase.js
//   3. Fai LOGOUT dal web (così cade nel ramo "local SQLite").
//   4. Refresh /dashboard → vedi 251 positions reali.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const TOOL_RESULTS_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-leone-puglisi-repos-job-hunter-team-dev2',
  'b6ab0688-f39e-4c59-b254-6abf0cd0b86b',
  'tool-results',
);

const FILES = {
  positions: 'mcp-supabase-execute_sql-1779198651521.txt',
  scores: 'mcp-supabase-execute_sql-1779198653109.txt',
  applications: 'mcp-supabase-execute_sql-1779198655405.txt',
};

function extractJsonArray(rawContent) {
  // MCP output: {"result":"... <untrusted-data-XXX>\\n[...]\\n</untrusted-data-XXX> ..."}
  const outer = JSON.parse(rawContent);
  const inner = typeof outer === 'string' ? outer : outer.result;
  const match = inner.match(/<untrusted-data-[^>]+>\s*(\[[\s\S]*?\])\s*<\/untrusted-data-[^>]+>/);
  if (!match) throw new Error('untrusted-data JSON block not found in tool-result file');
  return JSON.parse(match[1].trim());
}

function loadTable(name) {
  const filePath = path.join(TOOL_RESULTS_DIR, FILES[name]);
  const raw = fs.readFileSync(filePath, 'utf8');
  return extractJsonArray(raw);
}

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht');
const DB_PATH = path.join(JHT_HOME, 'jobs.db');

// Schema source-of-truth: web/lib/db.ts (kept in sync manually).
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);

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

PRAGMA user_version = 5;
`;

function backupExisting() {
  if (fs.existsSync(DB_PATH)) {
    const bak = `${DB_PATH}.bak-${Date.now()}`;
    fs.copyFileSync(DB_PATH, bak);
    console.log(`  Backup esistente: ${bak}`);
  }
}

// candidate_profile.yml: serve per soddisfare isProfileComplete() del layout
// quando l'utente è loggato-out e va su localhost. Dati copiati da
// candidate_profiles (Supabase) per user_id e_36c8539-…
function writeProfileYaml() {
  const profileDir = path.join(JHT_HOME, 'profile');
  const profilePath = path.join(profileDir, 'candidate_profile.yml');
  fs.mkdirSync(profileDir, { recursive: true });
  const yaml = `name: "Leone Emanuel Puglisi"
target_role: "Python Developer"
location: "Roma"
experience_years: 1
email: "beta-user@example.com"
has_degree: false
seniority_target: "junior"
work_authorization:
  - "EU"

skills:
  primary:
    - Python
    - SQL
    - Company Learning
    - Git
  secondary:
    - Flutter
    - Flask
    - Astro
    - Supabase
    - PostgreSQL
    - Pandas
    - Matplotlib
    - Seaborn
    - Scikit-learn
    - Automazione processi
    - AI / Chatbot

languages:
  - language: Italiano
    level: native
  - language: Inglese
    level: C1
  - language: Ungherese
    level: native

candidate:
  name: "Leone Emanuel Puglisi"
  target_role: "Python Developer"
  contacts:
    email: "beta-user@example.com"
  experience:
    - role: "Apprendista Programmatore"
      company: "Fincontinuo Spa"
      years: "2025 - in corso"
      location: "Roma"
      summary: |
        Sviluppo soluzioni software interne in Python per automatizzare processi
        aziendali nel settore finanziario. Realizzata applicazione di gestione
        documentale con interfaccia grafica e multiprocessing; chatbot AI che
        traduce domande in linguaggio naturale in query SQL.
  education:
    - degree: "Diploma di maturità in Informatica"
      institution: "Liceo Artistico Waldorf"
      location: "Prague"
      year: 2020
    - degree: "Specializzazione in Data Company"
      institution: "Develhope"
      year: "2024-2025"
    - degree: "Certificazioni online (Advanced Python, SQL, Flask)"
      institution: "Codecademy"
      year: "2024-2025"
`;
  fs.writeFileSync(profilePath, yaml, 'utf8');
  console.log(`Profile YAML written: ${profilePath}`);
}

function main() {
  fs.mkdirSync(JHT_HOME, { recursive: true });
  backupExisting();
  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}

  console.log(`Creating ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  const positions = loadTable('positions');
  const scores = loadTable('scores');
  const applications = loadTable('applications');
  console.log(`Loaded: positions=${positions.length}, scores=${scores.length}, applications=${applications.length}`);

  const uuidToInt = new Map();

  const insertPos = db.prepare(`
    INSERT INTO positions (
      title, company, company_id, location, remote_type,
      salary_declared_min, salary_declared_max, salary_declared_currency,
      salary_estimated_min, salary_estimated_max, salary_estimated_currency,
      salary_estimated_source,
      url, source, jd_text, requirements, found_by, found_at, deadline,
      status, notes, last_checked, created_at
    ) VALUES (?, ?, NULL, ?, ?,
      ?, ?, COALESCE(?, 'EUR'),
      ?, ?, COALESCE(?, 'EUR'),
      ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?)
  `);

  const insertScore = db.prepare(`
    INSERT INTO scores (
      position_id, total_score, stack_match, remote_fit, salary_fit,
      experience_fit, strategic_fit, breakdown, notes, scored_by,
      scored_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Pending messages: inline (solo 2, snapshot da Supabase 2026-05-19).
  const PENDING_MESSAGES = [
    {
      agent: 'capitano',
      body: 'Motore acceso. 🚀\n\nHo dato il via allo Scout-1 per cercare posizioni Python developer junior (remoto / Roma). Ti scrivo non appena ho il primo lotto da mostrarti.',
      kind: 'notification',
      related_position_uuid: null,
      delivered_via: 'telegram',
      delivered_at: '2026-05-16 17:12:20+00',
      created_at: '2026-05-16 17:12:20+00',
    },
    {
      agent: 'capitano',
      body: 'CV pronto per posizione #8 (Rinse Software Engineer). Critic verdict: PASS (6.0/10). PDF: /jht_user/cv/CV_Leone_Puglisi_Rinse.pdf',
      kind: 'notification',
      related_position_uuid: '0a2e05a4-c3be-4b44-8e04-0c53968f4a10',
      delivered_via: 'telegram',
      delivered_at: '2026-05-16 18:57:20+00',
      created_at: '2026-05-16 18:57:20+00',
    },
  ];
  const insertMsg = db.prepare(`
    INSERT INTO pending_user_messages (
      agent, body, kind, related_position_id, delivered_via,
      delivered_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertApp = db.prepare(`
    INSERT INTO applications (
      position_id, cv_path, cl_path, cv_pdf_path, cl_pdf_path,
      critic_verdict, critic_score, critic_notes, status,
      written_at, applied_at, applied_via, response, response_at,
      written_by, reviewed_by, critic_reviewed_at, applied,
      interview_round, cv_drive_id, cl_drive_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Specchia il CHECK constraint di Supabase (migration 015): location
  // > 200 char è quasi certamente un dump HTML/JD finito nel campo
  // sbagliato (vedi incidente 2026-05-19 row a4ed4925). I dump JSON da
  // cui leggiamo qui possono essere stale rispetto al fix su Supabase,
  // quindi clampiamo localmente per non rivedere l'incidente a ogni
  // re-seed. 197 + "…" = 200 (cap simbolico).
  //
  // Per la row nota (a4ed4925, RobertHalf "Junior Python Developer Company
  // in London") forziamo "London, UK" perché il troncato a 200 char è
  // comunque illeggibile (parte HTML "(initially 5 days onsite...").
  const KNOWN_BAD_LOCATIONS = {
    'a4ed4925-2e4e-4391-b565-a3af6ed29ef9': 'London, UK',
  };
  const sanitizeLocation = (uuid, loc) => {
    if (KNOWN_BAD_LOCATIONS[uuid]) return KNOWN_BAD_LOCATIONS[uuid];
    if (loc != null && loc.length > 200) return loc.slice(0, 197) + '…';
    return loc;
  };

  const insertAll = db.transaction(() => {
    for (const p of positions) {
      const r = insertPos.run(
        p.title, p.company, sanitizeLocation(p.id, p.location), p.remote_type,
        p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
        p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
        p.salary_estimated_source,
        p.url, p.source, p.jd_text, p.requirements, p.found_by, p.found_at, p.deadline,
        p.status, p.notes, p.last_checked, p.created_at,
      );
      uuidToInt.set(p.id, r.lastInsertRowid);
    }

    let scoreSkipped = 0;
    for (const s of scores) {
      const posId = uuidToInt.get(s.position_id);
      if (!posId) { scoreSkipped++; continue; }
      // SB schema (skill_match/experience_fit/location_fit/salary_fit)
      // vs SQLite (stack_match/remote_fit/salary_fit/experience_fit/strategic_fit):
      // mappiamo i campi comuni, le colonne diverse restano NULL.
      insertScore.run(
        posId,
        s.total_score,
        s.skill_match ?? s.stack_match ?? null,
        s.location_fit ?? s.remote_fit ?? null,
        s.salary_fit ?? null,
        s.experience_fit ?? null,
        s.strategic_fit ?? null,
        s.breakdown ?? null,
        s.notes ?? null,
        s.scored_by ?? null,
        s.scored_at ?? s.created_at,
        s.created_at,
      );
    }

    let appSkipped = 0;
    for (const a of applications) {
      const posId = uuidToInt.get(a.position_id);
      if (!posId) { appSkipped++; continue; }
      insertApp.run(
        posId,
        a.cv_path ?? null, a.cl_path ?? null,
        a.cv_pdf_path ?? null, a.cl_pdf_path ?? null,
        a.critic_verdict ?? null, a.critic_score ?? null, a.critic_notes ?? null,
        a.status ?? 'draft',
        a.written_at ?? null, a.applied_at ?? null, a.applied_via ?? null,
        a.response ?? null, a.response_at ?? null,
        a.written_by ?? null, a.reviewed_by ?? null, a.critic_reviewed_at ?? null,
        a.applied_at ? 1 : 0,
        a.interview_round ?? null,
        a.cv_drive_id ?? null, a.cl_drive_id ?? null,
        a.created_at,
      );
    }

    if (scoreSkipped) console.log(`  scores skipped (no matching position): ${scoreSkipped}`);
    if (appSkipped) console.log(`  applications skipped (no matching position): ${appSkipped}`);

    for (const m of PENDING_MESSAGES) {
      const relId = m.related_position_uuid ? uuidToInt.get(m.related_position_uuid) ?? null : null;
      insertMsg.run(m.agent, m.body, m.kind, relId, m.delivered_via, m.delivered_at, m.created_at);
    }
  });

  insertAll();

  const counts = db.prepare(`
    SELECT
      (SELECT count(*) FROM positions) as positions,
      (SELECT count(*) FROM scores) as scores,
      (SELECT count(*) FROM applications) as applications,
      (SELECT count(*) FROM pending_user_messages) as pending_messages
  `).get();
  console.log('Done:', counts);
  db.close();

  writeProfileYaml();
}

main();
