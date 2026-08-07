import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { JHT_HOME } from '../jht-paths.js';
import { GREEN, RED, YELLOW, DIM, RESET } from './_colors.js';
import { retiredStoreDetail } from './_retired-stores.js';

const JHT_DIR = JHT_HOME;

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function dirEntries(p) {
  try { return await readdir(p); } catch { return []; }
}

async function checkConfig() {
  const p = join(JHT_DIR, 'jht.config.json');
  if (!(await fileExists(p))) return { name: 'Config', status: 'error', detail: 'jht.config.json not found' };
  try { JSON.parse(await readFile(p, 'utf-8')); return { name: 'Config', status: 'ok', detail: 'valid' }; }
  catch { return { name: 'Config', status: 'error', detail: 'JSON invalid' }; }
}

// `sessions.json` e `analytics.json` non hanno più uno scrittore dal
// 2026-07-25: segnalarli come warning teneva l'health check in stato degradato
// per sempre, per una cosa che l'utente non può sistemare. Lo stato `gone` li
// racconta per quello che sono e non entra nel conteggio.
async function checkSessions() {
  const p = join(JHT_DIR, 'sessions', 'sessions.json');
  if (!(await fileExists(p))) return { name: 'Sessions', status: 'gone', detail: retiredStoreDetail('sessions') };
  try {
    const data = JSON.parse(await readFile(p, 'utf-8'));
    const active = (data.sessions ?? []).filter(s => s.state === 'active').length;
    return { name: 'Sessions', status: 'ok', detail: `${data.sessions?.length ?? 0} total, ${active} active` };
  } catch { return { name: 'Sessions', status: 'error', detail: 'Invalid JSON' }; }
}

async function checkAnalytics() {
  const p = join(JHT_DIR, 'analytics', 'analytics.json');
  if (!(await fileExists(p))) return { name: 'Analytics', status: 'gone', detail: retiredStoreDetail('analytics') };
  try {
    const data = JSON.parse(await readFile(p, 'utf-8'));
    return { name: 'Analytics', status: 'ok', detail: `${data.entries?.length ?? 0} entry` };
  } catch { return { name: 'Analytics', status: 'warn', detail: 'JSON invalid' }; }
}

async function checkCredentials() {
  const entries = await dirEntries(join(JHT_DIR, 'credentials'));
  const count = entries.filter(e => e.endsWith('.enc') || e.endsWith('.json')).length;
  return { name: 'Credentials', status: count > 0 ? 'ok' : 'warn', detail: `${count} providers` };
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
  return { name: 'Memory', status: found.length >= 2 ? 'ok' : 'warn', detail: found.length > 0 ? found.join(', ') : 'no bootstrap files' };
}

async function checkAgents() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const jht = out.trim().split('\n').filter(s => s.startsWith('JHT-') || s.startsWith('CAPITANO') || s.startsWith('SCOUT') || s.startsWith('ANALISTA') || s.startsWith('SCORER') || s.startsWith('SCRITTORE') || s.startsWith('CRITICO') || s.startsWith('ASSISTENTE'));
    return { name: 'Agents', status: jht.length > 0 ? 'ok' : 'warn', detail: `${jht.length} active tmux sessions` };
  } catch { return { name: 'Agents', status: 'warn', detail: 'tmux not available' }; }
}

const ICON = { ok: '●', warn: '◐', error: '✗', gone: '·' };
const COLOR = { ok: GREEN, warn: YELLOW, error: RED, gone: DIM };

async function handleHealth() {
  console.log('\n  JHT — Health Check\n');

  const checks = await Promise.all([
    checkConfig(), checkSessions(), checkAnalytics(),
    checkCredentials(), checkPlugins(), checkMemory(), checkAgents(),
  ]);

  const errors = checks.filter(c => c.status === 'error').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const gone = checks.filter(c => c.status === 'gone').length;
  const overall = errors > 0 ? 'error' : warns > 2 ? 'warn' : 'ok';

  for (const c of checks) {
    const icon = ICON[c.status];
    const color = COLOR[c.status];
    console.log(`  ${color}${icon}${RESET}  ${c.name.padEnd(14)} ${c.detail}`);
  }

  const overallLabel = overall === 'ok' ? 'OK' : overall === 'warn' ? 'WARNING' : 'ERROR';
  const coda = gone > 0 ? `, ${gone} with no remaining data source` : '';
  console.log(`\n  State: ${COLOR[overall]}${overallLabel}${RESET} — ${checks.length - errors - warns - gone} ok, ${warns} warnings, ${errors} errors${coda}\n`);
}

export function registerHealthCommand(program) {
  program
    .command('health')
    .description('Shows the health status of JHT modules')
    .action(handleHealth);
}
