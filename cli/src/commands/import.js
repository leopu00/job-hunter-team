import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { RETIRED_SINCE, isRetiredStore, retiredStoreFile } from './_retired-stores.js';
import { writePrivateJson } from '../lib/secure-config-io.js';

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
  writePrivateJson(p, data);
}

function validate(target, data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['Invalid JSON'], count: 0 };

  if (target === 'config') return { ok: true, errors: [], count: 1 };

  const cfg = TARGETS[target];
  const items = data[cfg.key] ?? data.data;
  if (!Array.isArray(items)) {
    errors.push(`Missing "${cfg.key}" or "data" field, or value is not an array`);
    return { ok: false, errors, count: 0 };
  }
  for (let i = 0; i < Math.min(items.length, 3); i++) {
    if (!items[i][cfg.idField]) errors.push(`[${i}]: missing "${cfg.idField}" field`);
  }
  return { ok: errors.length === 0, errors, count: items.length };
}

async function handleImport(file, options) {
  const target = options.target;
  if (!target || !TARGETS[target]) {
    console.error(`  Invalid target: ${target ?? '(missing)'}`);
    console.error(`  Targets available: ${Object.keys(TARGETS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!(await fileExists(file))) {
    console.error(`  File not found: ${file}`);
    process.exitCode = 1;
    return;
  }

  let data;
  try { data = JSON.parse(await readFile(file, 'utf-8')); }
  catch { console.error('  File is not a valid JSON'); process.exitCode = 1; return; }

  const v = validate(target, data);
  if (!v.ok) {
    console.error('  Failed validation:');
    v.errors.forEach(e => console.error(`    - ${e}`));
    process.exitCode = 1;
    return;
  }

  console.log(`  Found ${v.count} records to import`);

  // Scrivere nel posto giusto non basta se in quel posto non guarda più
  // nessuno: `sessions.json` e `tasks.json` li leggeva la vecchia interfaccia
  // testuale. I dati si conservano, ma l'utente deve sapere che importarli
  // non li rimette in circolo da nessuna parte.
  if (isRetiredStore(target)) {
    console.log('');
    console.log(`  Note: ${retiredStoreFile(target)} is no longer read by the product.`);
    console.log(`  The file is written and preserved, but no screen shows it —`);
    console.log(`  read the old text interface, remove the ${RETIRED_SINCE}.`);
  }

  if (options.dryRun) {
    console.log('  (dry-run — no modification applied)');
    return;
  }

  const cfg = TARGETS[target];
  const mode = options.replace ? 'replace' : 'merge';
  const dest = targetPath(cfg);

  if (target === 'config') {
    await writeJsonSafe(dest, data);
    console.log(`\n  Configuration imported (${mode}) → ${dest}`);
    return;
  }

  const items = data[cfg.key] ?? data.data;

  if (mode === 'replace') {
    const store = { [cfg.key]: items, updatedAt: Date.now() };
    if (target === 'tasks') store.version = 1;
    await writeJsonSafe(dest, store);
    console.log(`\n  ${items.length} records imported (replace) → ${dest}`);
    return;
  }

  // Merge
  const base = await readCurrent(cfg);
  if (base.legacy) {
    console.log(`  Base of the merge read from a position left by a previous version: ${base.from}`);
  }
  const existing = base.data ?? {};
  const current = existing[cfg.key] ?? [];
  const ids = new Set(current.map(r => r[cfg.idField]));
  const added = items.filter(r => !ids.has(r[cfg.idField]));
  existing[cfg.key] = [...current, ...added];
  existing.updatedAt = Date.now();
  await writeJsonSafe(dest, existing);
  console.log(`\n  ${added.length} records imported, ${items.length - added.length} duplicates skipped (merge) → ${dest}`);
}

export function registerImportCommand(program) {
  program
    .command('import <file>')
    .description('Import data from JSON file (target: sessions, tasks, config)')
    .requiredOption('-t, --target <target>', 'destination: sessions | tasks | config')
    .option('--replace', 'replace all data (default: merge)')
    .option('--dry-run', 'validate without importing')
    .action(handleImport);
}
