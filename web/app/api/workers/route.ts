/**
 * API Workers — Stato operativo real-time dei worker attivi
 */
import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic'

const TASKS_DIR = path.join(os.homedir(), '.jht-dev', 'tasks');

interface WorkerInfo {
  name: string;
  session: string;
  branch: string;
  currentTask: string | null;
  lastCommit: string | null;
  status: 'active' | 'idle' | 'offline';
}

const WORKER_SESSIONS: Record<string, { name: string; branch: string }> = {
  'JHT-FULLSTACK':   { name: 'Rex',  branch: 'fullstack' },
  'JHT-FULLSTACK-2': { name: 'Rex',  branch: 'fullstack-2' },
  'JHT-BACKEND':     { name: 'Gus',  branch: 'backend' },
  'JHT-BACKEND-2':   { name: 'Gus',  branch: 'backend-2' },
  'JHT-FRONTEND':    { name: 'Dot',  branch: 'frontend' },
  'JHT-FRONTEND-2':  { name: 'Dot',  branch: 'frontend-2' },
  'JHT-CLI':         { name: 'Leo',  branch: 'cli' },
  'JHT-CLI-2':       { name: 'Leo',  branch: 'cli-2' },
  'JHT-DEVOPS':      { name: 'Pip',  branch: 'devops' },
  'JHT-DEVOPS-2':    { name: 'Pip',  branch: 'devops-2' },
  'JHT-COORDINATOR': { name: 'Ace',  branch: '' },
  'JHT-GATEKEEPER':  { name: 'Master', branch: 'main' },
};

function getActiveSessions(): string[] {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

function getCurrentTask(branch: string): string | null {
  try {
    const prefix = branch.startsWith('fullstack') ? 'task-fs' : branch.startsWith('backend') ? 'task-be' : branch.startsWith('frontend') ? 'task-fe' : 'task';
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.md')).sort().reverse();
    for (const f of files) {
      const content = fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8');
      if (content.includes('stato: in-progress')) return f.replace('.md', '');
    }
  } catch { /* no tasks */ }
  return null;
}

function getLastCommit(branch: string): string | null {
  try {
    const out = execSync(`git log origin/${branch} --oneline -1 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 });
    return out.trim() || null;
  } catch { return null; }
}

export async function GET() {
  const active = getActiveSessions();

  const workers: WorkerInfo[] = Object.entries(WORKER_SESSIONS).map(([session, info]) => {
    const isOnline = active.includes(session);
    const task = info.branch ? getCurrentTask(info.branch) : null;
    const lastCommit = info.branch ? getLastCommit(info.branch) : null;
    return {
      name: info.name,
      session,
      branch: info.branch || '-',
      currentTask: task,
      lastCommit,
      status: isOnline ? (task ? 'active' : 'idle') : 'offline',
    };
  });

  const activeCount = workers.filter(w => w.status === 'active').length;
  const onlineCount = workers.filter(w => w.status !== 'offline').length;

  return NextResponse.json({ workers, activeCount, onlineCount, total: workers.length });
}
