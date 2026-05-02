import { readdir, rm, stat, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { JHT_HOME, JHT_CACHE_DIR } from '../jht-paths.js';

const CACHE_DIRS = [
  { name: '.cache',   path: JHT_CACHE_DIR },
  { name: 'tmp',      path: join(JHT_HOME, 'tmp') },
  { name: 'logs',     path: join(JHT_HOME, 'logs') },
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
  if (action === 'prune') return await cachePrune();
  if (action === 'clear') return await cacheClear();

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: stats, prune, clear');
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

// Soglie e safety per il prune dei log Codex SQLite. Codex ha già una
// retention interna di 10 giorni (PR openai/codex#13781) ma viene
// applicata SOLO quando il CLI gira; se l'utente non usa Codex per
// settimane il file cresce indefinitamente. Noi lo pruniamo on-demand
// qui sotto soglia + sopra mtime di sicurezza.
const CODEX_LOGS_DB = join(JHT_HOME, '.codex', 'logs_2.sqlite');
const CODEX_LOGS_THRESHOLD_BYTES = 50 * 1024 * 1024; // sotto i 50 MB non vale il rischio
const CODEX_LOGS_RETENTION_DAYS = 10;                 // allinea con la policy interna di Codex
const CODEX_LOGS_IDLE_SECONDS = 3600;                 // mtime > 1h fa = nessuno sta scrivendo

async function cachePrune() {
  console.log('\n  JHT — Cache Prune\n');
  await pruneUvCache();
  console.log('');
  await pruneCodexLogs();
  console.log('');
}

// Prune ($JHT_HOME/.cache/uv) — chiama `uv cache prune` con UV_CACHE_DIR
// puntato alla cache JHT. Safe: rimuove solo entry irraggiungibili (no
// wheel attivi). Non tocca ms-playwright (gestito dal Dockerfile via
// PLAYWRIGHT_BROWSERS_PATH=/opt/playwright) né claude-cli-nodejs (cresce
// linearmente coi cwd, gestito a parte).
async function pruneUvCache() {
  const uvCacheDir = join(JHT_CACHE_DIR, 'uv');
  if (!(await fileExists(uvCacheDir))) {
    console.log(`  uv cache: ${uvCacheDir} non esiste — niente da fare.`);
    return;
  }

  const before = await dirSize(uvCacheDir);
  console.log(`  uv cache: ${fmtSize(before.bytes)} (${before.files} file) prima del prune`);

  const r = spawnSync('uv', ['cache', 'prune'], {
    env: { ...process.env, UV_CACHE_DIR: uvCacheDir },
    encoding: 'utf-8',
  });

  if (r.error) {
    if (r.error.code === 'ENOENT') {
      console.error('  ✗ uv non trovato nel PATH. Skip prune.');
      console.error('    (Installa uv: https://docs.astral.sh/uv/getting-started/installation/)');
    } else {
      console.error(`  ✗ uv cache prune fallito: ${r.error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  if (r.status !== 0) {
    console.error(`  ✗ uv cache prune exit ${r.status}: ${r.stderr || r.stdout}`);
    process.exitCode = 1;
    return;
  }

  // uv stampa "Removed N files (X.XMiB)" — la lasciamo passare.
  if (r.stdout) process.stdout.write(`  ${r.stdout.trim().split('\n').join('\n  ')}\n`);

  const after = await dirSize(uvCacheDir);
  const freed = before.bytes - after.bytes;
  console.log(`  uv cache: ${fmtSize(after.bytes)} (${after.files} file) dopo il prune`);
  console.log(`  liberati: ${fmtSize(freed > 0 ? freed : 0)}`);
}

// Prune ($JHT_HOME/.codex/logs_2.sqlite) — DELETE righe più vecchie di 10
// giorni + VACUUM. Si attiva SOLO sopra 50 MB e SOLO se nessuno scrive
// al file da almeno 1 ora (proxy: mtime). Codex usa WAL, quindi
// modificare il DB mentre il CLI gira può causare lock contention o
// readers che vedono stato incoerente — la mtime check è la safety.
async function pruneCodexLogs() {
  if (!(await fileExists(CODEX_LOGS_DB))) {
    console.log('  codex logs: file non presente, skip.');
    return;
  }

  const s = await stat(CODEX_LOGS_DB);
  if (s.size < CODEX_LOGS_THRESHOLD_BYTES) {
    console.log(`  codex logs: ${fmtSize(s.size)} (< soglia ${fmtSize(CODEX_LOGS_THRESHOLD_BYTES)}) — skip.`);
    return;
  }

  const idleSeconds = (Date.now() - s.mtimeMs) / 1000;
  if (idleSeconds < CODEX_LOGS_IDLE_SECONDS) {
    const idleMin = Math.round(idleSeconds / 60);
    console.log(`  codex logs: ${fmtSize(s.size)} ma scritto ${idleMin}min fa (Codex potrebbe essere attivo) — skip per safety.`);
    return;
  }

  const idleHours = Math.round(idleSeconds / 3600);
  console.log(`  codex logs: ${fmtSize(s.size)} prima del prune (idle ${idleHours}h)`);

  // DELETE + VACUUM in una sola invocazione sqlite3. VACUUM rilascia le
  // free pages al filesystem; senza, il file resta della stessa
  // dimensione anche dopo il DELETE.
  const sql = `DELETE FROM logs WHERE ts < unixepoch('now', '-${CODEX_LOGS_RETENTION_DAYS} days'); VACUUM;`;
  const r = spawnSync('sqlite3', [CODEX_LOGS_DB, sql], {
    encoding: 'utf-8',
    timeout: 120_000, // VACUUM su 200 MB può prendere ~30s, doppio per safety
  });

  if (r.error) {
    if (r.error.code === 'ENOENT') {
      console.error('  ✗ sqlite3 non trovato nel PATH. Skip codex logs prune.');
    } else {
      console.error(`  ✗ codex logs prune fallito: ${r.error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  if (r.status !== 0) {
    console.error(`  ✗ sqlite3 exit ${r.status}: ${r.stderr || r.stdout}`);
    process.exitCode = 1;
    return;
  }

  const after = await stat(CODEX_LOGS_DB);
  const freed = s.size - after.size;
  console.log(`  codex logs: ${fmtSize(after.size)} dopo il prune`);
  console.log(`  liberati: ${fmtSize(freed > 0 ? freed : 0)}`);
}

export function registerCacheCommand(program) {
  program
    .command('cache [action]')
    .description('Gestione cache JHT (azioni: stats, prune, clear)')
    .action(handleCache);
}
