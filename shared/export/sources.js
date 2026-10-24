// Le sorgenti che si possono esportare: le tabelle VIVE di `jobs.db`.
//
// Il sito (`/export`), `jht export` e l'esportazione dell'app desktop devono
// offrire le stesse sorgenti con le stesse colonne: il contratto è
// banda/piani/CONTRATTO-export-dati-20261024.md. La lista dell'app sta nello
// script Python di `desktop/src-tauri/src/team_export.rs`; un test
// (tests/js/tasks/export-sources.test.ts) le confronta, e confronta anche
// ogni tabella con chi la scrive.
//
// Colonne a elenco ESPLICITO, mai `SELECT *`: restano fuori i percorsi interni
// (cv_path, cl_path, *_drive_id…), le coordinate e tutto ciò che non sta in
// `jobs.db` (chiavi, token, credenziali, config).

/** @type {Record<string, { table: string, dateColumn: string, columns: readonly string[] }>} */
export const EXPORT_SOURCES = {
  positions: {
    table: 'positions',
    dateColumn: 'found_at',
    columns: ['id', 'title', 'company', 'company_id', 'location', 'remote_type', 'salary_declared_min', 'salary_declared_max', 'salary_declared_currency', 'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency', 'salary_estimated_source', 'url', 'source', 'jd_text', 'requirements', 'jd_summary', 'found_by', 'found_at', 'deadline', 'status', 'notes', 'last_checked', 'role_family', 'loc_city', 'loc_region', 'loc_country', 'loc_country_code', 'work_mode', 'work_country', 'work_country_code', 'is_multi_location', 'location_notes', 'office_address', 'expires_at', 'is_open', 'salary_precise', 'created_at', 'updated_at'],
  },
  scores: {
    table: 'scores',
    dateColumn: 'scored_at',
    columns: ['id', 'position_id', 'total_score', 'stack_match', 'remote_fit', 'salary_fit', 'experience_fit', 'strategic_fit', 'breakdown', 'notes', 'scored_by', 'scored_at', 'created_at'],
  },
  applications: {
    table: 'applications',
    dateColumn: 'created_at',
    columns: ['id', 'position_id', 'critic_verdict', 'critic_score', 'critic_notes', 'critic_round', 'status', 'written_at', 'applied_at', 'applied_via', 'response', 'response_at', 'rejection_reason', 'rejection_note', 'written_by', 'reviewed_by', 'critic_reviewed_at', 'applied', 'interview_round', 'created_at', 'updated_at'],
  },
  companies: {
    table: 'companies',
    dateColumn: 'created_at',
    columns: ['id', 'name', 'website', 'hq_country', 'sector', 'size', 'glassdoor_rating', 'red_flags', 'culture_notes', 'analyzed_by', 'analyzed_at', 'verdict', 'created_at', 'updated_at'],
  },
  feedback: {
    table: 'position_feedback',
    dateColumn: 'created_at',
    columns: ['id', 'position_id', 'action', 'reason', 'comment', 'note', 'score', 'direction', 'created_at'],
  },
  notes: {
    table: 'position_user_notes',
    dateColumn: 'updated_at',
    columns: ['position_id', 'origin', 'body', 'created_at', 'updated_at'],
  },
};

/**
 * Le sorgenti che il sito e il CLI offrivano e che non esistono più: file JSON
 * che nessun componente della squadra attuale scrive (tre dal 25/07/2026, le
 * altre mai nate). Si risponde con una frase, non con un file vuoto: uno zero
 * qui sarebbe indistinguibile da una squadra che non ha fatto niente.
 */
export const RETIRED_EXPORT_SOURCES = {
  sessions: 'sessions.json',
  tasks: 'tasks.json',
  analytics: 'analytics.json',
  jobs: 'jobs.json',
  contacts: 'contacts.json',
  interviews: 'interviews.json',
};
// `applications` e `companies` avevano anch'esse un file JSON: ora sono tabelle,
// con lo stesso nome, e il file non è più la sorgente.

/** Una sorgente ritirata, con la frase che la dice (nella lingua del CLI e dell'API). */
export function retiredExportNotice(source) {
  return `"${source}" is not a data source any more: no component of the team writes ${RETIRED_EXPORT_SOURCES[source]}. `
    + `Export one of: ${Object.keys(EXPORT_SOURCES).join(', ')}.`;
}

export function isRetiredExportSource(source) {
  return Object.hasOwn(RETIRED_EXPORT_SOURCES, source);
}

export function isExportSource(source) {
  return typeof source === 'string' && Object.hasOwn(EXPORT_SOURCES, source);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Il periodo chiesto, come giorni `YYYY-MM-DD` (`to` incluso). `null` se un
 * estremo non è un giorno o se `from` viene dopo `to`.
 */
export function exportRange(from, to) {
  const since = from ? String(from) : null;
  const until = to ? String(to) : null;
  if ((since && !DAY.test(since)) || (until && !DAY.test(until))) return null;
  if (since && until && since > until) return null;
  return { since, until };
}

function clean(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return null;
  return value;
}

/**
 * Le righe di una sorgente, lette dal DB (`prepare(sql).all(...params)`:
 * `better-sqlite3` e `node:sqlite` lo fanno allo stesso modo), nell'ordine del
 * `rowid`. Una colonna che un DB più vecchio non ha è lasciata fuori; una
 * tabella che non c'è ancora è zero righe; con un periodo e senza la colonna
 * della data non c'è niente da dire (zero righe). Un'altra rottura la lascia
 * salire: un errore non deve passare per un file vuoto.
 *
 * @param {{ prepare(sql: string): { all(...params: unknown[]): any[] } }} db
 * @param {string} source
 * @param {{ since: string | null, until: string | null }} [range]
 * @returns {{ columns: string[], rows: Record<string, unknown>[] }}
 */
export function readExportRows(db, source, range = { since: null, until: null }) {
  // `Object.hasOwn`: `__proto__` e simili non sono sorgenti, qualunque cosa chiami.
  const spec = isExportSource(source) ? EXPORT_SOURCES[source] : undefined;
  if (!spec) throw new Error('export_source_invalid');
  const have = db.prepare(`PRAGMA table_info(${spec.table})`).all().map((row) => row.name);
  const columns = spec.columns.filter((name) => have.includes(name));
  if (have.length === 0) return { columns: [...spec.columns], rows: [] };
  let where = '1=1';
  const args = [];
  if (range.since || range.until) {
    if (!have.includes(spec.dateColumn)) return { columns, rows: [] };
    if (range.since) { where += ` AND substr(${spec.dateColumn},1,10)>=?`; args.push(range.since); }
    if (range.until) { where += ` AND substr(${spec.dateColumn},1,10)<=?`; args.push(range.until); }
  }
  const list = columns.length ? columns.join(',') : '1';
  const found = db.prepare(`SELECT ${list} FROM ${spec.table} WHERE ${where} ORDER BY rowid`).all(...args);
  const rows = found.map((row) => Object.fromEntries(columns.map((name) => [name, clean(row[name])])));
  return { columns, rows };
}

/**
 * Le chiavi i cui valori non escono mai: la stessa regola del backup dell'app
 * (`team_backup.rs`, `SECRET`), che un test confronta con questa. Case-insensitive.
 */
export const SECRET_KEY = /(api[_-]?key|token|secret|passw|credential|authorization|bearer|private[_-]?key)/i;

/** Una copia del valore con a `null` ogni valore la cui chiave e' un segreto, a qualunque profondita'. */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? null : redactSecrets(item)]),
    );
  }
  return value;
}
