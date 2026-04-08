import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

function resolveHomeDir() {
  return process.env.JHT_HOME || process.env.HOME || process.env.USERPROFILE || homedir();
}

const JHT_DIR = join(resolveHomeDir(), '.jht');

const TARGETS = {
  sessions: { path: join(JHT_DIR, 'sessions', 'sessions.json'), key: 'sessions', idField: 'id' },
  tasks:    { path: join(JHT_DIR, 'tasks', 'tasks.json'),       key: 'tasks',    idField: 'taskId' },
  config:   { path: join(JHT_DIR, 'jht.config.json'),           key: null,        idField: null },
};

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJsonSafe(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return null; }
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

  if (options.dryRun) {
    console.log('  (dry-run — nessuna modifica applicata)');
    return;
  }

  const cfg = TARGETS[target];
  const mode = options.replace ? 'replace' : 'merge';

  if (target === 'config') {
    await writeJsonSafe(cfg.path, data);
    console.log(`\n  Config importata (${mode})`);
    return;
  }

  const items = data[cfg.key] ?? data.data;

  if (mode === 'replace') {
    const store = { [cfg.key]: items, updatedAt: Date.now() };
    if (target === 'tasks') store.version = 1;
    await writeJsonSafe(cfg.path, store);
    console.log(`\n  ${items.length} record importati (replace)`);
    return;
  }

  // Merge
  const existing = (await readJsonSafe(cfg.path)) ?? {};
  const current = existing[cfg.key] ?? [];
  const ids = new Set(current.map(r => r[cfg.idField]));
  const added = items.filter(r => !ids.has(r[cfg.idField]));
  existing[cfg.key] = [...current, ...added];
  existing.updatedAt = Date.now();
  await writeJsonSafe(cfg.path, existing);
  console.log(`\n  ${added.length} record importati, ${items.length - added.length} duplicati saltati (merge)`);
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
