import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR       = join(homedir(), '.jht');
const SESSIONS_PATH = join(JHT_DIR, 'sessions', 'sessions.json');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const STATE_CFG = {
  active: { icon: `${GREEN}●${RESET}`, label: `${GREEN}attiva${RESET}` },
  paused: { icon: `${YELLOW}◐${RESET}`, label: `${YELLOW}pausa${RESET}` },
  ended:  { icon: `${DIM}○${RESET}`,    label: `${DIM}terminata${RESET}` },
};

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start, end) {
  const s = Math.floor(((end || Date.now()) - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

async function handleSessions(options) {
  if (!(await fileExists(SESSIONS_PATH))) {
    console.log(`\n  ${DIM}Nessuna sessione trovata.${RESET}\n`);
    return;
  }

  let store;
  try { store = JSON.parse(await readFile(SESSIONS_PATH, 'utf-8')); }
  catch { console.error('  Errore lettura sessioni'); process.exitCode = 1; return; }

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

  console.log(`\n  ${BOLD}JHT — Sessioni${RESET} (${total} totali, ${active} attive, ${paused} in pausa)\n`);

  if (sessions.length === 0) {
    console.log(`  ${DIM}Nessuna sessione${filter ? ` con stato "${filter}"` : ''}.${RESET}\n`);
    return;
  }

  console.log(`  ${'ID'.padEnd(14)} ${'Stato'.padEnd(14)} ${'Canale'.padEnd(10)} ${'Msg'.padEnd(6)} ${'Durata'.padEnd(8)} ${'Data'}`);
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
    console.log(`\n  ${DIM}Provider usati:${RESET}`);
    const providers = new Set((store.sessions ?? []).map(s => s.provider).filter(Boolean));
    for (const p of providers) console.log(`    ${p}`);
  }

  console.log('');
}

export function registerSessionsCommand(program) {
  program
    .command('sessions')
    .description('Lista sessioni con stato e statistiche')
    .option('--active', 'mostra solo attive')
    .option('--ended', 'mostra solo terminate')
    .option('--paused', 'mostra solo in pausa')
    .option('-t, --tail <n>', 'numero sessioni (default 30)', '30')
    .option('-v, --verbose', 'mostra dettagli provider')
    .action(handleSessions);
}
