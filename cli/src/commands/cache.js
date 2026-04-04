import { readdir, rm, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR   = join(homedir(), '.jht');
const CACHE_DIR = join(JHT_DIR, 'cache');

const CACHE_DIRS = [
  { name: 'cache',    path: CACHE_DIR },
  { name: 'tmp',      path: join(JHT_DIR, 'tmp') },
  { name: 'logs',     path: join(JHT_DIR, 'logs') },
];

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function dirSize(dirPath) {
  let total = 0;
  let count = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const e of entries) {
      if (e.isFile()) {
        try {
          const s = await stat(join(e.parentPath ?? e.path ?? dirPath, e.name));
          total += s.size;
          count++;
        } catch { /* skip */ }
      }
    }
  } catch { /* dir not found */ }
  return { bytes: total, files: count };
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function handleCache(action) {
  if (!action || action === 'stats') return await cacheStats();
  if (action === 'clear') return await cacheClear();

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: stats, clear');
  process.exitCode = 1;
}

async function cacheStats() {
  console.log('\n  JHT — Cache Stats\n');

  let totalBytes = 0;
  let totalFiles = 0;

  for (const d of CACHE_DIRS) {
    const exists = await fileExists(d.path);
    if (!exists) {
      console.log(`  ${d.name.padEnd(10)} —  (non trovata)`);
      continue;
    }
    const { bytes, files } = await dirSize(d.path);
    totalBytes += bytes;
    totalFiles += files;
    console.log(`  ${d.name.padEnd(10)} ${String(files).padStart(5)} file   ${fmtSize(bytes).padStart(10)}`);
  }

  console.log(`  ${'─'.repeat(35)}`);
  console.log(`  ${'totale'.padEnd(10)} ${String(totalFiles).padStart(5)} file   ${fmtSize(totalBytes).padStart(10)}\n`);
}

async function cacheClear() {
  console.log('\n  Pulizia cache…\n');

  let cleared = 0;
  for (const d of CACHE_DIRS) {
    if (!(await fileExists(d.path))) continue;
    try {
      const { files } = await dirSize(d.path);
      await rm(d.path, { recursive: true, force: true });
      cleared += files;
      console.log(`  ✓ ${d.name}: ${files} file rimossi`);
    } catch (e) {
      console.error(`  ✗ ${d.name}: ${e.message}`);
    }
  }

  console.log(`\n  ${cleared} file rimossi in totale.\n`);
}

export function registerCacheCommand(program) {
  program
    .command('cache [action]')
    .description('Gestione cache (azioni: stats, clear)')
    .action(handleCache);
}
