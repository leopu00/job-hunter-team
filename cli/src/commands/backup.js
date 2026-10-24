import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { RETIRED_SINCE, retiredStoreFile } from './_retired-stores.js';
import { ensurePrivateDir, writePrivateJson } from '../lib/secure-config-io.js';
import { redactSecrets, countPlainSecrets, mergeLiveSecrets } from '../lib/backup-secrets.js';

const JHT_DIR    = JHT_HOME;
const BACKUP_DIR = join(JHT_DIR, 'backups');

const BACKUP_FILES = [
  'jht.config.json',
  'sessions/sessions.json',
  'tasks/tasks.json',
  'analytics/analytics.json',
  'history.json',
  'tools-config.json',
  'plugins-config.json',
  'retry/circuit-breakers.json',
];

// Tre voci della lista qui sopra non hanno più uno scrittore dal 2026-07-25.
// Se mancano, il backup non è incompleto per colpa di qualcosa che si può
// aggiustare: quel dato non viene più prodotto. Vale la pena scriverlo,
// perché "File salvati: 0" da solo sembra un backup fallito.
const RETIRED_ENTRIES = {
  'sessions/sessions.json': 'sessions',
  'tasks/tasks.json':       'tasks',
  'analytics/analytics.json': 'analytics',
};

function reportRetired(mancanti) {
  if (mancanti.length === 0) return;
  const files = mancanti.map(rel => retiredStoreFile(RETIRED_ENTRIES[rel])).join(', ');
  console.log(`  Missing: ${files}`);
  console.log(`  ${mancanti.length > 1 ? 'These files are' : 'This file is'} no longer produced by any component.`);
  console.log(`  ${mancanti.length > 1 ? 'They belonged' : 'It belonged'} to the retired text interface (${RETIRED_SINCE}), so this backup is complete.`);
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf-8')); } catch { return undefined; }
}

async function handleBackup(action, options) {
  ensurePrivateDir(BACKUP_DIR);

  if (!action || action === 'create') return await createBackup(options);
  if (action === 'list' || action === 'ls') return await listBackups();
  if (action === 'restore') return await restoreBackup(options);
  if (action === 'scrub') return await scrubBackups();

  console.error(`  Invalid action: ${action}`);
  console.error('  Actions: create, list, restore, scrub');
  process.exitCode = 1;
}

// Backups made before secrets were left out hold the providers' keys in clear.
async function backupsWithPlainSecrets() {
  const entries = await readdir(BACKUP_DIR).catch(() => []);
  const found = [];
  for (const name of entries.filter(e => e.startsWith('backup-')).sort()) {
    const files = [];
    for (const rel of BACKUP_FILES) {
      const value = await readJson(join(BACKUP_DIR, name, rel));
      const secrets = value === undefined ? 0 : countPlainSecrets(value);
      if (secrets > 0) files.push({ rel, secrets });
    }
    if (files.length > 0) found.push({ name, files });
  }
  return found;
}

function warnPlainSecrets(found) {
  if (found.length === 0) return;
  const keys = found.reduce((n, b) => n + b.files.reduce((m, f) => m + f.secrets, 0), 0);
  console.log(`  Warning: ${found.length} older ${found.length > 1 ? 'backups hold' : 'backup holds'} ${keys} key${keys > 1 ? 's' : ''} (API keys, tokens, passwords) in clear:`);
  for (const b of found) console.log(`    ${b.name}`);
  console.log('  They sit in the same folder as your data. Run: jht backup scrub');
  console.log('');
}

async function scrubBackups() {
  const found = await backupsWithPlainSecrets();
  if (found.length === 0) {
    console.log('\n  No backup holds keys in clear.\n');
    return;
  }
  let keys = 0;
  for (const b of found) {
    ensurePrivateDir(join(BACKUP_DIR, b.name));
    for (const f of b.files) {
      const path = join(BACKUP_DIR, b.name, f.rel);
      const value = await readJson(path);
      writePrivateJson(path, redactSecrets(value));
      keys += f.secrets;
    }
  }
  console.log(`\n  Cleaned ${found.length} ${found.length > 1 ? 'backups' : 'backup'}: ${keys} key${keys > 1 ? 's' : ''} removed (saved as null).`);
  console.log('  Restoring one of them keeps the keys you use now.\n');
}

async function createBackup(options) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = options.label ? `-${options.label.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const name = `backup-${ts}${label}`;
  const dir = join(BACKUP_DIR, name);
  ensurePrivateDir(dir);

  let count = 0;
  let secrets = 0;
  const retiredMancanti = [];
  const unreadable = [];
  for (const rel of BACKUP_FILES) {
    const src = join(JHT_DIR, rel);
    if (!(await fileExists(src))) {
      if (RETIRED_ENTRIES[rel]) retiredMancanti.push(rel);
      continue;
    }
    // Never a raw copy: a file that cannot be read as JSON cannot be cleaned,
    // so it is left out and said.
    const value = await readJson(src);
    if (value === undefined) { unreadable.push(rel); continue; }
    secrets += countPlainSecrets(value);
    writePrivateJson(join(dir, rel), redactSecrets(value));
    count++;
  }

  // Manifest
  const manifest = { name, createdAt: new Date().toISOString(), files: count, secrets: 'left-out' };
  writePrivateJson(join(dir, 'manifest.json'), manifest);

  console.log(`\n  Backup created: ${name}`);
  console.log(`  Files saved: ${count}`);
  console.log(`  Path: ${dir}`);
  console.log(`  Keys left out: ${secrets} (API keys, tokens and passwords are saved as null, never in clear)\n`);
  if (unreadable.length > 0) {
    console.log(`  Not saved (not readable as JSON): ${unreadable.join(', ')}\n`);
  }
  reportRetired(retiredMancanti);
  if (retiredMancanti.length > 0) console.log('');
  warnPlainSecrets(await backupsWithPlainSecrets());
}

async function listBackups() {
  const entries = await readdir(BACKUP_DIR).catch(() => []);
  const backups = entries.filter(e => e.startsWith('backup-')).sort().reverse();

  if (backups.length === 0) {
    console.log('\n  No backup found.\n');
    return;
  }

  console.log(`\n  ${backups.length} backups available:\n`);
  for (const b of backups) {
    const mPath = join(BACKUP_DIR, b, 'manifest.json');
    let detail = '';
    if (await fileExists(mPath)) {
      try {
        const m = JSON.parse(await readFile(mPath, 'utf-8'));
        detail = `  ${m.files} file — ${m.createdAt}`;
      } catch { /* skip */ }
    }
    console.log(`    ${b}${detail}`);
  }
  console.log('');
  warnPlainSecrets(await backupsWithPlainSecrets());
}

async function restoreBackup(options) {
  const name = options.name;
  if (!name) {
    console.error('  Required --name option for restore');
    console.error('  Example: jht backup restore --name backup-2026-04-04T12-00-00');
    process.exitCode = 1;
    return;
  }

  const dir = join(BACKUP_DIR, name);
  if (!(await fileExists(dir))) {
    console.error(`  Backup not found: ${name}`);
    process.exitCode = 1;
    return;
  }

  let count = 0;
  let kept = 0;
  const retiredRipristinati = [];
  const unreadable = [];
  for (const rel of BACKUP_FILES) {
    const src = join(dir, rel);
    if (!(await fileExists(src))) continue;
    const saved = await readJson(src);
    if (saved === undefined) { unreadable.push(rel); continue; }
    // The copy has no keys: the ones in use now stay where they are.
    const live = await readJson(join(JHT_DIR, rel));
    const merged = mergeLiveSecrets(saved, live);
    kept += countPlainSecrets(merged) - countPlainSecrets(saved);
    writePrivateJson(join(JHT_DIR, rel), merged);
    if (RETIRED_ENTRIES[rel]) retiredRipristinati.push(rel);
    count++;
  }

  console.log(`\n  Backup restored: ${name}`);
  console.log(`  Files restored: ${count}`);
  if (kept > 0) console.log(`  Keys kept from the current files: ${kept}`);
  console.log('');
  if (unreadable.length > 0) {
    console.log(`  Not restored (not readable as JSON): ${unreadable.join(', ')}\n`);
  }

  // Rimessi al loro posto, ma non rimessi in circolo: dirlo qui evita che
  // l'utente aspetti di rivederli comparire da qualche parte.
  if (retiredRipristinati.length > 0) {
    const files = retiredRipristinati.map(rel => retiredStoreFile(RETIRED_ENTRIES[rel])).join(', ');
    console.log(`  Note: ${files} ${retiredRipristinati.length > 1 ? 'were' : 'was'} restored, but no screen reads ${retiredRipristinati.length > 1 ? 'them' : 'it'} anymore.`);
    console.log(`  The retired text interface was removed on ${RETIRED_SINCE}.\n`);
  }
}

export function registerBackupCommand(program) {
  program
    .command('backup [action]')
    .description('Manage backups (actions: create, list, restore, scrub)')
    .option('-l, --label <label>', 'label for backup')
    .option('-n, --name <name>', 'backup name to restore')
    .action(handleBackup);
}
