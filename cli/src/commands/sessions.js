import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { GREEN, YELLOW, DIM, BOLD, RESET } from './_colors.js';
import { retiredStoreNotice } from './_retired-stores.js';

const JHT_DIR       = JHT_HOME;
const SESSIONS_PATH = join(JHT_DIR, 'sessions', 'sessions.json');

const STATE_CFG = {
  active: { icon: `${GREEN}●${RESET}`, label: `${GREEN}active${RESET}` },
  paused: { icon: `${YELLOW}◐${RESET}`, label: `${YELLOW}paused${RESET}` },
  ended:  { icon: `${DIM}○${RESET}`,    label: `${DIM}ended${RESET}` },
};

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start, end) {
  const s = Math.floor(((end || Date.now()) - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

async function handleSessions(options) {
  // "Nessuna sessione trovata" suonava come un elenco vuoto. Il file non
  // esiste perché nessuno lo scrive più dal 2026-07-25, ed è un'altra cosa.
  if (!(await fileExists(SESSIONS_PATH))) {
    console.log(`\n  ${BOLD}JHT — Sessions${RESET}\n`);
    console.log(retiredStoreNotice(['sessions']));
    console.log('');
    process.exitCode = 1;
    return;
  }

  let store;
  try { store = JSON.parse(await readFile(SESSIONS_PATH, 'utf-8')); }
  catch { console.error('  Error reading sessions'); process.exitCode = 1; return; }

  let sessions = store.sessions ?? [];

  // Filtro stato
  const filter = options.active ? 'active' : options.ended ? 'ended' : options.paused ? 'paused' : null;
  if (filter) sessions = sessions.filter(s => s.state === filter);

  // Ordina per ultimo aggiornamento
  sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));

  const tail = Math.min(parseInt(options.tail ?? '30', 10) || 30, 200);
  sessions = sessions.slice(0, tail);

  const total = store.sessions?.length ?? 0;
  const active = (store.sessions ?? []).filter(s => s.state === 'active').length;
  const paused = (store.sessions ?? []).filter(s => s.state === 'paused').length;

  console.log(`\n  ${BOLD}JHT — Sessions${RESET} (${total} total, ${active} active, ${paused} paused)\n`);

  if (sessions.length === 0) {
    console.log(`  ${DIM}No session${filter ? ` with state "${filter}"` : ''}.${RESET}\n`);
    return;
  }

  console.log(`  ${'ID'.padEnd(14)} ${'State'.padEnd(14)} ${'Channel'.padEnd(10)} ${'Msg'.padEnd(6)} ${'Duration'.padEnd(8)} ${'Date'}`);
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(16)}`);

  for (const s of sessions) {
    const cfg = STATE_CFG[s.state] ?? STATE_CFG.ended;
    const id = (s.label ?? s.id ?? '').slice(0, 12);
    const channel = s.channelId ?? '—';
    const msgs = String(s.messageCount ?? 0);
    const dur = fmtDuration(s.createdAtMs, s.lastMessageAtMs ?? s.updatedAtMs);
    const date = fmtDate(s.createdAtMs);
    console.log(`  ${cfg.icon} ${id.padEnd(12)} ${cfg.label.padEnd(23)} ${channel.padEnd(10)} ${msgs.padEnd(6)} ${dur.padEnd(8)} ${date}`);
  }

  if (options.verbose) {
    console.log(`\n  ${DIM}Providers used:${RESET}`);
    const providers = new Set((store.sessions ?? []).map(s => s.provider).filter(Boolean));
    for (const p of providers) console.log(`    ${p}`);
  }

  console.log('');
}

export function registerSessionsCommand(program) {
  program
    .command('sessions')
    .description('List of sessions with status and statistics')
    .option('--active', 'show only active')
    .option('--ended', 'show only finished')
    .option('--paused', 'show only paused sessions')
    .option('-t, --tail <n>', 'number of sessions (default 30)', '30')
    .option('-v, --verbose', 'show provider details')
    .action(handleSessions);
}
