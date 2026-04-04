import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const JHT_DIR     = join(homedir(), '.jht');
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');
const TASKS_PATH  = join(JHT_DIR, 'tasks', 'tasks.json');

const AGENTS = [
  { id: 'alfa',       name: 'Capitano',    session: 'ALFA' },
  { id: 'scout',      name: 'Scout',       session: 'SCOUT-1' },
  { id: 'analista',   name: 'Analista',    session: 'ANALISTA-1' },
  { id: 'scorer',     name: 'Scorer',      session: 'SCORER-1' },
  { id: 'scrittore',  name: 'Scrittore',   session: 'SCRITTORE-1' },
  { id: 'critico',    name: 'Critico',     session: 'CRITICO' },
  { id: 'sentinella', name: 'Sentinella',  session: 'SENTINELLA' },
  { id: 'assistente', name: 'Assistente',  session: 'ASSISTENTE' },
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function getTmuxSessions() {
  try {
    return execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim().split('\n').filter(Boolean);
  } catch { return []; }
}

async function handleAgents(options) {
  const sessions = getTmuxSessions();

  // Task per agente
  let tasksByAgent = {};
  if (await fileExists(TASKS_PATH)) {
    try {
      const store = JSON.parse(await readFile(TASKS_PATH, 'utf-8'));
      for (const t of store.tasks ?? []) {
        if (!t.agentId) continue;
        if (!tasksByAgent[t.agentId]) tasksByAgent[t.agentId] = { total: 0, succeeded: 0, failed: 0, running: 0 };
        tasksByAgent[t.agentId].total++;
        if (t.status === 'succeeded') tasksByAgent[t.agentId].succeeded++;
        if (t.status === 'failed') tasksByAgent[t.agentId].failed++;
        if (t.status === 'running') tasksByAgent[t.agentId].running++;
      }
    } catch { /* skip */ }
  }

  const running = AGENTS.filter(a => sessions.includes(a.session));
  const stopped = AGENTS.filter(a => !sessions.includes(a.session));

  console.log(`\n  ${BOLD}JHT — Agenti${RESET} (${running.length}/${AGENTS.length} attivi)\n`);
  console.log(`  ${'Agente'.padEnd(14)} ${'Sessione'.padEnd(16)} ${'Stato'.padEnd(10)} ${'Task'.padEnd(20)}`);
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(10)} ${'─'.repeat(20)}`);

  for (const a of AGENTS) {
    const isRunning = sessions.includes(a.session);
    const icon = isRunning ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    const status = isRunning ? `${GREEN}attivo${RESET}` : `${DIM}fermo${RESET}`;
    const t = tasksByAgent[a.id];
    let taskInfo = `${DIM}—${RESET}`;
    if (t) {
      const parts = [];
      if (t.succeeded) parts.push(`${GREEN}${t.succeeded}✓${RESET}`);
      if (t.failed) parts.push(`${RED}${t.failed}✗${RESET}`);
      if (t.running) parts.push(`${YELLOW}${t.running}⟳${RESET}`);
      taskInfo = `${t.total} tot ${parts.join(' ')}`;
    }
    console.log(`  ${icon} ${a.name.padEnd(12)} ${a.session.padEnd(16)} ${status.padEnd(19)} ${taskInfo}`);
  }

  if (options.verbose && running.length > 0) {
    console.log(`\n  ${DIM}Sessioni tmux JHT attive:${RESET}`);
    for (const s of sessions.filter(s => AGENTS.some(a => a.session === s))) {
      console.log(`    ${s}`);
    }
  }

  console.log('');
}

export function registerAgentsCommand(program) {
  program
    .command('agents')
    .description('Mostra lista agenti con stato tmux e task')
    .option('-v, --verbose', 'mostra dettagli sessioni tmux')
    .action(handleAgents);
}
