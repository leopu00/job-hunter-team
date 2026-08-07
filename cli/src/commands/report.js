import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { JHT_HOME } from '../jht-paths.js';
import { BOLD, GREEN, RED, DIM, RESET } from './_colors.js';
import { retiredStoreDetail } from './_retired-stores.js';

const JHT_DIR        = JHT_HOME;
const TASKS_PATH     = join(JHT_DIR, 'tasks', 'tasks.json');
const ANALYTICS_PATH = join(JHT_DIR, 'analytics', 'analytics.json');
const SESSIONS_PATH  = join(JHT_DIR, 'sessions', 'sessions.json');
const DEPLOY_DIR     = join(JHT_DIR, 'deploy');

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJsonSafe(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return null; }
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function handleReport(options) {
  const days = parseInt(options.days ?? '30', 10) || 30;
  const since = Date.now() - days * 86_400_000;

  console.log(`\n  ${BOLD}═══════════════════════════════════════${RESET}`);
  console.log(`  ${BOLD}  JHT — Project Report${RESET}`);
  console.log(`  ${BOLD}  Period: last ${days} days${RESET}`);
  console.log(`  ${BOLD}  Generated: ${new Date().toLocaleString('en-US')}${RESET}`);
  console.log(`  ${BOLD}═══════════════════════════════════════${RESET}\n`);

  // Task / API / Sessioni leggono tre store che nessuno scrive più dal
  // 2026-07-25. Un report che li stampa a zero racconta un progetto fermo:
  // la sezione dice invece che la fonte non c'è. Il resto del report (moduli,
  // deploy, git) legge dati vivi e resta com'è.
  const has = {
    tasks:     await fileExists(TASKS_PATH),
    analytics: await fileExists(ANALYTICS_PATH),
    sessions:  await fileExists(SESSIONS_PATH),
  };

  // Task
  const taskStore = await readJsonSafe(TASKS_PATH);
  const tasks = (taskStore?.tasks ?? []).filter(t => (t.createdAt ?? 0) >= since);
  const succeeded = tasks.filter(t => t.status === 'succeeded').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const rate = tasks.length > 0 ? Math.round((succeeded / tasks.length) * 100) : 0;

  console.log(`  ${BOLD}Task${RESET}`);
  if (!has.tasks) {
    console.log(`    ${DIM}${retiredStoreDetail('tasks')}${RESET}\n`);
  } else {
    console.log(`    Total:        ${tasks.length}`);
    console.log(`    ${GREEN}Completed:${RESET}    ${succeeded}`);
    console.log(`    ${RED}Failed:${RESET}       ${failed}`);
    console.log(`    In progress:     ${running}`);
    console.log(`    Success rate: ${rate}%\n`);
  }

  // API / Analytics
  const analyticsStore = await readJsonSafe(ANALYTICS_PATH);
  const entries = (analyticsStore?.entries ?? []).filter(e => (e.timestamp ?? 0) >= since);
  const tokens = entries.reduce((s, e) => s + (e.tokens?.total ?? 0), 0);
  const cost = entries.reduce((s, e) => s + (e.costUsd ?? 0), 0);
  const errors = entries.filter(e => !e.success).length;

  console.log(`  ${BOLD}API${RESET}`);
  if (!has.analytics) {
    console.log(`    ${DIM}${retiredStoreDetail('analytics')}${RESET}\n`);
  } else {
    console.log(`    Calls:        ${entries.length}`);
    console.log(`    Token:        ${tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens}`);
    console.log(`    Cost: $${cost.toFixed(4)}`);
    console.log(`    Errors:       ${errors}\n`);
  }

  // Sessioni
  const sessStore = await readJsonSafe(SESSIONS_PATH);
  const sessions = (sessStore?.sessions ?? []).filter(s => (s.createdAtMs ?? 0) >= since);
  const active = sessions.filter(s => s.state === 'active').length;
  const totalMsgs = sessions.reduce((s, sess) => s + (sess.messageCount ?? 0), 0);

  console.log(`  ${BOLD}Sessions${RESET}`);
  if (!has.sessions) {
    console.log(`    ${DIM}${retiredStoreDetail('sessions')}${RESET}\n`);
  } else {
    console.log(`    Total:        ${sessions.length}`);
    console.log(`    Active:       ${active}`);
    console.log(`    Messages:     ${totalMsgs}\n`);
  }

  // Moduli attivi
  const sharedDirs = [];
  try {
    const root = execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const entries = await readdir(join(root, 'shared'), { withFileTypes: true });
    for (const e of entries) { if (e.isDirectory()) sharedDirs.push(e.name); }
  } catch { /* skip */ }

  if (sharedDirs.length > 0) {
    console.log(`  ${BOLD}Moduli shared/${RESET} (${sharedDirs.length})`);
    console.log(`    ${DIM}${sharedDirs.join(', ')}${RESET}\n`);
  }

  // Ultimo deploy
  if (await fileExists(DEPLOY_DIR)) {
    const deployFiles = await readdir(DEPLOY_DIR).catch(() => []);
    const latest = deployFiles.filter(f => f.endsWith('.json')).sort().pop();
    if (latest) {
      const d = await readJsonSafe(join(DEPLOY_DIR, latest));
      console.log(`  ${BOLD}Latest deployment${RESET}`);
      console.log(`    Date:    ${fmtDate(d?.timestamp ?? d?.deployedAt)}`);
      console.log(`    State:   ${d?.status ?? '—'}`);
      if (d?.version) console.log(`    Version: ${d.version}`);
      console.log('');
    }
  }

  // Git
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const commits = execSync(`git rev-list --count --since="${new Date(since).toISOString()}" HEAD 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    console.log(`  ${BOLD}Git${RESET}`);
    console.log(`    Branch:  ${branch}`);
    console.log(`    Commits: ${commits} (last ${days} days)\n`);
  } catch { /* skip */ }

  console.log(`  ${DIM}─────────────────────────────────────${RESET}\n`);
}

export function registerReportCommand(program) {
  program
    .command('report')
    .description('Generate a text project-status report')
    .option('-d, --days <n>', 'period in days (default 30)', '30')
    .action(handleReport);
}
