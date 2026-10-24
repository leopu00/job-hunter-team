import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JHT_DB_PATH, JHT_HOME } from '../jht-paths.js';
// Stesso neutralizzatore della route web: il file esportato qui finisce
// nello stesso Excel, e una cella che comincia per `=` viene valutata
// all'apertura. Vedi shared/export/csv.js.
import { toCsv } from '../../../shared/export/csv.js';
// Le sorgenti sono le tabelle vive di jobs.db, le stesse del sito e dell'app
// (shared/export/sources.js): quelle che nessuno scrive piu' si dicono, non si
// esportano vuote.
import {
  EXPORT_SOURCES,
  exportRange,
  isExportSource,
  isRetiredExportSource,
  readExportRows,
  redactSecrets,
  retiredExportNotice,
} from '../../../shared/export/sources.js';

const JHT_DIR = JHT_HOME;

// Fino a oggi questo file si calcolava la home da solo e poi ci aggiungeva
// `.jht`, ma JHT_HOME *è già* la JHT home (`/jht_home` nel container): il
// risultato era `<jht home>/.jht/...`, una cartella che nessun altro comando
// tocca. Chi ci ha dei dati li ritrova ancora, ma solo in lettura e solo
// quando la posizione giusta è vuota: qui dentro non si scrive più.
const LEGACY_JHT_DIR = join(JHT_DIR, '.jht');

// Oltre alle tabelle di jobs.db, il file di configurazione dell'utente.
const FILE_SOURCES = {
  config: { rel: ['jht.config.json'] },
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

export async function handleExport(source, options) {
  if (isRetiredExportSource(source)) {
    console.error(`  ${retiredExportNotice(source)}`);
    process.exitCode = 1;
    return;
  }
  if (isExportSource(source)) return exportTable(source, options);
  const src = FILE_SOURCES[source];
  if (!src) {
    console.error(`  Invalid source: ${source}`);
    console.error(`  Sources available: ${[...Object.keys(EXPORT_SOURCES), ...Object.keys(FILE_SOURCES)].join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const found = await resolveSourcePath(src.rel);
  if (found.missing) {
    console.error(`  File not found: ${found.path}`);
    process.exitCode = 1;
    return;
  }
  if (found.legacy) {
    console.log(`  Bed from a position left by a previous version: ${found.path}`);
  }

  const raw = await readFile(found.path, 'utf-8');
  // The config holds the provider keys and the bot tokens: they leave as null, as in the app's backup.
  const data = redactSecrets(JSON.parse(raw));
  console.log('  Keys, tokens and passwords in the config are exported empty.');
  await writeOutput(Array.isArray(data) ? data : [data], source, options);
}

/** Una tabella viva di jobs.db, in sola lettura, con lo stesso periodo del sito (`to` incluso). */
async function exportTable(source, options) {
  const range = exportRange(options.from, options.to);
  if (!range) {
    console.error('  Invalid date range (use YYYY-MM-DD, from <= to)');
    process.exitCode = 1;
    return;
  }
  if (!(await fileExists(JHT_DB_PATH))) {
    // Nessun jobs.db = una squadra che non ha mai girato: non e' un file vuoto.
    console.error(`  No database at ${JHT_DB_PATH}: the team has not run yet, so there is nothing to export.`);
    process.exitCode = 1;
    return;
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(JHT_DB_PATH, { readOnly: true });
  let rows;
  try {
    rows = readExportRows(db, source, range).rows;
  } catch (error) {
    console.error(`  Could not read ${source} from the database: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    return;
  } finally {
    db.close();
  }
  if (options.from || options.to) console.log(`  Date filter: ${rows.length} records`);
  await writeOutput(rows, source, options);
}

async function writeOutput(items, source, options) {
  const format = options.csv ? 'csv' : 'json';
  const date = new Date().toISOString().slice(0, 10);
  const outPath = options.output || `jht-${source}-${date}.${format}`;
  const content = format === 'csv' ? toCsv(items) : JSON.stringify({ source, count: items.length, exportedAt: new Date().toISOString(), data: items }, null, 2);

  await mkdir(dirname(outPath), { recursive: true }).catch(() => {});
  await writeFile(outPath, content, 'utf-8');
  console.log(`\n  Exported ${items.length} records → ${outPath} (${format.toUpperCase()})`);
}

export function registerExportCommand(program) {
  program
    .command('export <source>')
    .description('Export data to JSON or CSV (source: positions, scores, applications, companies, feedback, notes, config; the config goes out without keys and tokens)')
    .option('-o, --output <path>', 'output file path')
    .option('--csv', 'export to CSV format')
    .option('--from <date>', 'filter start date (YYYY-MM-DD)')
    .option('--to <date>', 'filter end date (YYYY-MM-DD)')
    .action(handleExport);
}
