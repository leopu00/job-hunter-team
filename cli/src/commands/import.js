import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { RETIRED_SINCE, isRetiredStore, retiredStoreFile } from './_retired-stores.js';

const JHT_DIR = JHT_HOME;

// Fino a oggi questo file si calcolava la home da solo e poi ci aggiungeva
// `.jht`, ma JHT_HOME *è già* la JHT home (`/jht_home` nel container). Il
// merge leggeva e la scrittura finiva in `<jht home>/.jht/...`, che nessuno
// rilegge: `jht import -t config` stampava "Config importata" e non
// ripristinava niente. Ora si scrive solo nella posizione canonica; la
// vecchia resta leggibile, come base del merge, per chi ci ha dei dati.
const LEGACY_JHT_DIR = join(JHT_DIR, '.jht');

const TARGETS = {
  sessions: { rel: ['sessions', 'sessions.json'], key: 'sessions', idField: 'id' },
  tasks:    { rel: ['tasks', 'tasks.json'],       key: 'tasks',    idField: 'taskId' },
  config:   { rel: ['jht.config.json'],           key: null,       idField: null },
};

function targetPath(cfg) {
  return join(JHT_DIR, ...cfg.rel);
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJsonSafe(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return null; }
}

/**
 * Contenuto attuale del target: quello canonico, o — se non c'è — quello
 * lasciato dalla vecchia posizione sbagliata. Sola lettura: il risultato del
 * merge torna comunque nella posizione canonica.
 */
async function readCurrent(cfg) {
  const canonical = targetPath(cfg);
  if (await fileExists(canonical)) return { data: await readJsonSafe(canonical), from: canonical, legacy: false };
  const legacy = join(LEGACY_JHT_DIR, ...cfg.rel);
  if (await fileExists(legacy)) return { data: await readJsonSafe(legacy), from: legacy, legacy: true };
  return { data: null, from: canonical, legacy: false };
}

async function writeJsonSafe(p, data) {
  await mkdir(dirname(p), { recursive: true }).catch(() => {});
  const tmp = p + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, p);
}

function validate(target, data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['JSON non valido'], count: 0 };

  if (target === 'config') return { ok: true, errors: [], count: 1 };

  const cfg = TARGETS[target];
  const items = data[cfg.key] ?? data.data;
  if (!Array.isArray(items)) {
    errors.push(`Campo "${cfg.key}" o "data" mancante o non array`);
    return { ok: false, errors, count: 0 };
  }
  for (let i = 0; i < Math.min(items.length, 3); i++) {
    if (!items[i][cfg.idField]) errors.push(`[${i}]: campo "${cfg.idField}" mancante`);
  }
  return { ok: errors.length === 0, errors, count: items.length };
}

async function handleImport(file, options) {
  const target = options.target;
  if (!target || !TARGETS[target]) {
    console.error(`  Target non valido: ${target ?? '(mancante)'}`);
    console.error(`  Target disponibili: ${Object.keys(TARGETS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!(await fileExists(file))) {
    console.error(`  File non trovato: ${file}`);
    process.exitCode = 1;
    return;
  }

  let data;
  try { data = JSON.parse(await readFile(file, 'utf-8')); }
  catch { console.error('  File non è un JSON valido'); process.exitCode = 1; return; }

  const v = validate(target, data);
  if (!v.ok) {
    console.error('  Validazione fallita:');
    v.errors.forEach(e => console.error(`    - ${e}`));
    process.exitCode = 1;
    return;
  }

  console.log(`  Trovati ${v.count} record da importare`);

  // Scrivere nel posto giusto non basta se in quel posto non guarda più
  // nessuno: `sessions.json` e `tasks.json` li leggeva la vecchia interfaccia
  // testuale. I dati si conservano, ma l'utente deve sapere che importarli
  // non li rimette in circolo da nessuna parte.
  if (isRetiredStore(target)) {
    console.log('');
    console.log(`  Nota: ${retiredStoreFile(target)} non ha più un lettore nel prodotto.`);
    console.log(`  Il file viene scritto e conservato, ma nessuna schermata lo mostra —`);
    console.log(`  lo leggeva la vecchia interfaccia testuale, rimossa il ${RETIRED_SINCE}.`);
  }

  if (options.dryRun) {
    console.log('  (dry-run — nessuna modifica applicata)');
    return;
  }

  const cfg = TARGETS[target];
  const mode = options.replace ? 'replace' : 'merge';
  const dest = targetPath(cfg);

  if (target === 'config') {
    await writeJsonSafe(dest, data);
    console.log(`\n  Config importata (${mode}) → ${dest}`);
    return;
  }

  const items = data[cfg.key] ?? data.data;

  if (mode === 'replace') {
    const store = { [cfg.key]: items, updatedAt: Date.now() };
    if (target === 'tasks') store.version = 1;
    await writeJsonSafe(dest, store);
    console.log(`\n  ${items.length} record importati (replace) → ${dest}`);
    return;
  }

  // Merge
  const base = await readCurrent(cfg);
  if (base.legacy) {
    console.log(`  Base del merge letta da una posizione lasciata da una versione precedente: ${base.from}`);
  }
  const existing = base.data ?? {};
  const current = existing[cfg.key] ?? [];
  const ids = new Set(current.map(r => r[cfg.idField]));
  const added = items.filter(r => !ids.has(r[cfg.idField]));
  existing[cfg.key] = [...current, ...added];
  existing.updatedAt = Date.now();
  await writeJsonSafe(dest, existing);
  console.log(`\n  ${added.length} record importati, ${items.length - added.length} duplicati saltati (merge) → ${dest}`);
}

export function registerImportCommand(program) {
  program
    .command('import <file>')
    .description('Importa dati da file JSON (target: sessions, tasks, config)')
    .requiredOption('-t, --target <target>', 'destinazione: sessions | tasks | config')
    .option('--replace', 'sostituisci tutti i dati (default: merge)')
    .option('--dry-run', 'valida senza importare')
    .action(handleImport);
}
