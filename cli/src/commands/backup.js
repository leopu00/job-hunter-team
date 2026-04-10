import { readFile, writeFile, mkdir, readdir, access, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

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

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function handleBackup(action, options) {
  await mkdir(BACKUP_DIR, { recursive: true });

  if (!action || action === 'create') return await createBackup(options);
  if (action === 'list' || action === 'ls') return await listBackups();
  if (action === 'restore') return await restoreBackup(options);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: create, list, restore');
  process.exitCode = 1;
}

async function createBackup(options) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = options.label ? `-${options.label.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const name = `backup-${ts}${label}`;
  const dir = join(BACKUP_DIR, name);
  await mkdir(dir, { recursive: true });

  let count = 0;
  for (const rel of BACKUP_FILES) {
    const src = join(JHT_DIR, rel);
    if (!(await fileExists(src))) continue;
    const dest = join(dir, rel);
    await mkdir(join(dest, '..'), { recursive: true }).catch(() => {});
    await cp(src, dest);
    count++;
  }

  // Manifest
  const manifest = { name, createdAt: new Date().toISOString(), files: count };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n  Backup creato: ${name}`);
  console.log(`  File salvati: ${count}`);
  console.log(`  Percorso: ${dir}\n`);
}

async function listBackups() {
  const entries = await readdir(BACKUP_DIR).catch(() => []);
  const backups = entries.filter(e => e.startsWith('backup-')).sort().reverse();

  if (backups.length === 0) {
    console.log('\n  Nessun backup trovato.\n');
    return;
  }

  console.log(`\n  ${backups.length} backup disponibili:\n`);
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
}

async function restoreBackup(options) {
  const name = options.name;
  if (!name) {
    console.error('  Opzione --name obbligatoria per restore');
    console.error('  Esempio: jht backup restore --name backup-2026-04-04T12-00-00');
    process.exitCode = 1;
    return;
  }

  const dir = join(BACKUP_DIR, name);
  if (!(await fileExists(dir))) {
    console.error(`  Backup non trovato: ${name}`);
    process.exitCode = 1;
    return;
  }

  let count = 0;
  for (const rel of BACKUP_FILES) {
    const src = join(dir, rel);
    if (!(await fileExists(src))) continue;
    const dest = join(JHT_DIR, rel);
    await mkdir(join(dest, '..'), { recursive: true }).catch(() => {});
    await cp(src, dest);
    count++;
  }

  console.log(`\n  Backup ripristinato: ${name}`);
  console.log(`  File ripristinati: ${count}\n`);
}

export function registerBackupCommand(program) {
  program
    .command('backup [action]')
    .description('Gestione backup (azioni: create, list, restore)')
    .option('-l, --label <label>', 'etichetta per il backup')
    .option('-n, --name <name>', 'nome backup da ripristinare')
    .action(handleBackup);
}
