import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR        = join(homedir(), '.jht');
const TASKS_PATH     = join(JHT_DIR, 'tasks', 'tasks.json');
const ANALYTICS_PATH = join(JHT_DIR, 'analytics', 'analytics.json');
const SESSIONS_PATH  = join(JHT_DIR, 'sessions', 'sessions.json');

const DIM = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJsonSafe(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return null; }
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

async function handleStats(options) {
  const days = parseInt(options.days ?? '30', 10) || 30;
  const since = Date.now() - days * 86_400_000;

  console.log(`\n  JHT — Statistiche (ultimi ${days} giorni)\n`);

  // Task
  const taskStore = await readJsonSafe(TASKS_PATH);
  const tasks = (taskStore?.tasks ?? []).filter(t => (t.createdAt ?? 0) >= since);
  const succeeded = tasks.filter(t => t.status === 'succeeded').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const durations = tasks.filter(t => t.startedAt && t.endedAt).map(t => t.endedAt - t.startedAt);
  const avgDur = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  console.log(`  ${BOLD}Task${RESET}`);
  console.log(`  ${DIM}Totali:${RESET}    ${tasks.length}`);
  console.log(`  ${GREEN}Successo:${RESET}  ${succeeded}   ${RED}Falliti:${RESET} ${failed}   ${YELLOW}In corso:${RESET} ${running}`);
  if (tasks.length > 0) {
    const rate = Math.round((succeeded / tasks.length) * 100);
    console.log(`  ${DIM}Success rate:${RESET} ${rate}%   ${DIM}Durata media:${RESET} ${fmtDuration(avgDur)}`);
  }

  // Analytics
  const analyticsStore = await readJsonSafe(ANALYTICS_PATH);
  const entries = (analyticsStore?.entries ?? []).filter(e => (e.timestamp ?? 0) >= since);
  const totalTokens = entries.reduce((s, e) => s + (e.tokens?.total ?? 0), 0);
  const totalCost = entries.reduce((s, e) => s + (e.costUsd ?? 0), 0);
  const errors = entries.filter(e => !e.success).length;
  const latencies = entries.map(e => e.latencyMs).filter(Boolean);
  const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  console.log(`\n  ${BOLD}API${RESET}`);
  console.log(`  ${DIM}Chiamate:${RESET}  ${entries.length}   ${RED}Errori:${RESET} ${errors}`);
  console.log(`  ${DIM}Token:${RESET}     ${totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens}`);
  console.log(`  ${DIM}Costo:${RESET}     $${totalCost.toFixed(4)}   ${DIM}Latenza media:${RESET} ${avgLat}ms`);

  // Per provider
  const byProvider = new Map();
  for (const e of entries) {
    const p = e.provider ?? 'unknown';
    const cur = byProvider.get(p) ?? { calls: 0, tokens: 0, cost: 0 };
    cur.calls++; cur.tokens += e.tokens?.total ?? 0; cur.cost += e.costUsd ?? 0;
    byProvider.set(p, cur);
  }
  if (byProvider.size > 0) {
    console.log(`  ${DIM}Per provider:${RESET}`);
    for (const [p, d] of byProvider) {
      console.log(`    ${p}: ${d.calls} chiamate, ${d.tokens > 1000 ? `${(d.tokens / 1000).toFixed(1)}k` : d.tokens} token, $${d.cost.toFixed(4)}`);
    }
  }

  // Sessioni
  const sessStore = await readJsonSafe(SESSIONS_PATH);
  const sessions = (sessStore?.sessions ?? []).filter(s => (s.createdAtMs ?? 0) >= since);
  const active = sessions.filter(s => s.state === 'active').length;
  const totalMsgs = sessions.reduce((s, sess) => s + (sess.messageCount ?? 0), 0);

  console.log(`\n  ${BOLD}Sessioni${RESET}`);
  console.log(`  ${DIM}Totali:${RESET}    ${sessions.length}   ${GREEN}Attive:${RESET} ${active}`);
  console.log(`  ${DIM}Messaggi:${RESET}  ${totalMsgs}`);

  console.log('');
}

export function registerStatsCommand(program) {
  program
    .command('stats')
    .description('Mostra statistiche aggregate (task, API, sessioni)')
    .option('-d, --days <n>', 'periodo in giorni (default 30)', '30')
    .action(handleStats);
}
