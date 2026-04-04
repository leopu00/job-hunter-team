import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const JHT_DIR = join(homedir(), '.jht');

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function dirEntries(p) {
  try { return await readdir(p); } catch { return []; }
}

async function checkConfig() {
  const p = join(JHT_DIR, 'jht.config.json');
  if (!(await fileExists(p))) return { name: 'Config', status: 'error', detail: 'jht.config.json non trovato' };
  try { JSON.parse(await readFile(p, 'utf-8')); return { name: 'Config', status: 'ok', detail: 'valido' }; }
  catch { return { name: 'Config', status: 'error', detail: 'JSON non valido' }; }
}

async function checkSessions() {
  const p = join(JHT_DIR, 'sessions', 'sessions.json');
  if (!(await fileExists(p))) return { name: 'Sessioni', status: 'warn', detail: 'file non trovato' };
  try {
    const data = JSON.parse(await readFile(p, 'utf-8'));
    const active = (data.sessions ?? []).filter(s => s.state === 'active').length;
    return { name: 'Sessioni', status: 'ok', detail: `${data.sessions?.length ?? 0} totali, ${active} attive` };
  } catch { return { name: 'Sessioni', status: 'error', detail: 'JSON non valido' }; }
}

async function checkAnalytics() {
  const p = join(JHT_DIR, 'analytics', 'analytics.json');
  if (!(await fileExists(p))) return { name: 'Analytics', status: 'warn', detail: 'file non trovato' };
  try {
    const data = JSON.parse(await readFile(p, 'utf-8'));
    return { name: 'Analytics', status: 'ok', detail: `${data.entries?.length ?? 0} entry` };
  } catch { return { name: 'Analytics', status: 'warn', detail: 'JSON non valido' }; }
}

async function checkCredentials() {
  const entries = await dirEntries(join(JHT_DIR, 'credentials'));
  const count = entries.filter(e => e.endsWith('.enc') || e.endsWith('.json')).length;
  return { name: 'Credenziali', status: count > 0 ? 'ok' : 'warn', detail: `${count} provider` };
}

async function checkPlugins() {
  const entries = await dirEntries(join(JHT_DIR, 'plugins'));
  return { name: 'Plugin', status: 'ok', detail: `${entries.length} installati` };
}

async function checkMemory() {
  const files = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md'];
  const found = [];
  for (const f of files) {
    if (await fileExists(join(JHT_DIR, f))) found.push(f.replace('.md', ''));
  }
  return { name: 'Memoria', status: found.length >= 2 ? 'ok' : 'warn', detail: found.length > 0 ? found.join(', ') : 'nessun file bootstrap' };
}

async function checkAgents() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const jht = out.trim().split('\n').filter(s => s.startsWith('JHT-') || s.startsWith('ALFA') || s.startsWith('SCOUT') || s.startsWith('ANALISTA') || s.startsWith('SCORER') || s.startsWith('SCRITTORE') || s.startsWith('CRITICO') || s.startsWith('SENTINELLA') || s.startsWith('ASSISTENTE'));
    return { name: 'Agenti', status: jht.length > 0 ? 'ok' : 'warn', detail: `${jht.length} sessioni tmux attive` };
  } catch { return { name: 'Agenti', status: 'warn', detail: 'tmux non disponibile' }; }
}

const ICON = { ok: '●', warn: '◐', error: '✗' };
const COLOR = { ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

async function handleHealth() {
  console.log('\n  JHT — Health Check\n');

  const checks = await Promise.all([
    checkConfig(), checkSessions(), checkAnalytics(),
    checkCredentials(), checkPlugins(), checkMemory(), checkAgents(),
  ]);

  const errors = checks.filter(c => c.status === 'error').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const overall = errors > 0 ? 'error' : warns > 2 ? 'warn' : 'ok';

  for (const c of checks) {
    const icon = ICON[c.status];
    const color = COLOR[c.status];
    console.log(`  ${color}${icon}${RESET}  ${c.name.padEnd(14)} ${c.detail}`);
  }

  const overallLabel = overall === 'ok' ? 'OK' : overall === 'warn' ? 'WARNING' : 'ERROR';
  console.log(`\n  Stato: ${COLOR[overall]}${overallLabel}${RESET} — ${checks.length - errors - warns} ok, ${warns} warning, ${errors} errori\n`);
}

export function registerHealthCommand(program) {
  program
    .command('health')
    .description('Mostra lo stato di salute dei moduli JHT')
    .action(handleHealth);
}
