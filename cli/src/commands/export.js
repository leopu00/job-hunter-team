import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR = JHT_HOME;

// Fino a oggi questo file si calcolava la home da solo e poi ci aggiungeva
// `.jht`, ma JHT_HOME *è già* la JHT home (`/jht_home` nel container): il
// risultato era `<jht home>/.jht/...`, una cartella che nessun altro comando
// tocca. Chi ci ha dei dati li ritrova ancora, ma solo in lettura e solo
// quando la posizione giusta è vuota: qui dentro non si scrive più.
const LEGACY_JHT_DIR = join(JHT_DIR, '.jht');

const SOURCES = {
  sessions:  { rel: ['sessions', 'sessions.json'],   key: 'sessions' },
  tasks:     { rel: ['tasks', 'tasks.json'],         key: 'tasks' },
  config:    { rel: ['jht.config.json'],             key: null },
  analytics: { rel: ['analytics', 'analytics.json'], key: 'entries' },
};

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Posizione canonica, con un ripiego di sola lettura sulla vecchia.
 * `missing` significa "in nessuna delle due"; il path restituito è allora
 * quello canonico, perché è quello che ha senso mostrare all'utente.
 */
async function resolveSourcePath(rel) {
  const canonical = join(JHT_DIR, ...rel);
  if (await fileExists(canonical)) return { path: canonical, legacy: false, missing: false };
  const legacy = join(LEGACY_JHT_DIR, ...rel);
  if (await fileExists(legacy)) return { path: legacy, legacy: true, missing: false };
  return { path: canonical, legacy: false, missing: true };
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.map(esc).join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}

async function handleExport(source, options) {
  const src = SOURCES[source];
  if (!src) {
    console.error(`  Sorgente non valida: ${source}`);
    console.error(`  Sorgenti disponibili: ${Object.keys(SOURCES).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const found = await resolveSourcePath(src.rel);
  if (found.missing) {
    console.error(`  File non trovato: ${found.path}`);
    process.exitCode = 1;
    return;
  }
  if (found.legacy) {
    console.log(`  Letto da una posizione lasciata da una versione precedente: ${found.path}`);
  }

  const raw = await readFile(found.path, 'utf-8');
  const data = JSON.parse(raw);
  const items = src.key ? (data[src.key] ?? []) : data;

  // Filtro date
  if (options.from || options.to) {
    const since = options.from ? new Date(options.from).getTime() : 0;
    const until = options.to ? new Date(options.to + 'T23:59:59').getTime() : Date.now();
    const tsField = source === 'sessions' ? 'createdAtMs' : source === 'analytics' ? 'timestamp' : 'createdAt';
    if (Array.isArray(items)) {
      const before = items.length;
      const filtered = items.filter(r => { const t = r[tsField] ?? 0; return t >= since && t <= until; });
      console.log(`  Filtro date: ${filtered.length}/${before} record`);
      return await writeOutput(filtered, source, options);
    }
  }

  await writeOutput(Array.isArray(items) ? items : [items], source, options);
}

async function writeOutput(items, source, options) {
  const format = options.csv ? 'csv' : 'json';
  const date = new Date().toISOString().slice(0, 10);
  const outPath = options.output || `jht-${source}-${date}.${format}`;
  const content = format === 'csv' ? toCsv(items) : JSON.stringify({ source, count: items.length, exportedAt: new Date().toISOString(), data: items }, null, 2);

  await mkdir(dirname(outPath), { recursive: true }).catch(() => {});
  await writeFile(outPath, content, 'utf-8');
  console.log(`\n  Esportati ${items.length} record → ${outPath} (${format.toUpperCase()})`);
}

export function registerExportCommand(program) {
  program
    .command('export <source>')
    .description('Esporta dati in JSON o CSV (source: sessions, tasks, config, analytics)')
    .option('-o, --output <path>', 'percorso file di output')
    .option('--csv', 'esporta in formato CSV')
    .option('--from <date>', 'data inizio filtro (YYYY-MM-DD)')
    .option('--to <date>', 'data fine filtro (YYYY-MM-DD)')
    .action(handleExport);
}
