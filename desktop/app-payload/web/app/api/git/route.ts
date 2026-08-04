/**
 * API Git — Branch attivi, ultimo commit, ahead/behind master, diff stat
 */
import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';

export const dynamic = 'force-dynamic'

interface BranchInfo {
  name: string;
  lastCommit: string;
  lastCommitDate: string;
  author: string;
  ahead: number;
  behind: number;
  diffStat: { files: number; insertions: number; deletions: number };
  isCurrent: boolean;
}

function exec(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8', timeout: 5000, cwd: process.cwd() }).trim(); }
  catch { return ''; }
}

function getRemoteBranches(): string[] {
  const out = exec('git branch -r --format="%(refname:short)" 2>/dev/null');
  if (!out) return [];
  return out.split('\n')
    .filter(b => b.startsWith('origin/') && !b.includes('HEAD'))
    .map(b => b.replace('origin/', ''));
}

function getBranchInfo(branch: string, currentBranch: string): BranchInfo {
  const ref = `origin/${branch}`;
  const logFmt = exec(`git log ${ref} -1 --format="%h %s|||%ar|||%an" 2>/dev/null`);
  const [commitMsg, date, author] = logFmt.split('|||');

  let ahead = 0, behind = 0;
  if (branch !== 'main' && branch !== 'master') {
    const base = exec('git rev-parse --verify origin/main 2>/dev/null') ? 'origin/main' : 'origin/master';
    const revList = exec(`git rev-list --left-right --count ${base}...${ref} 2>/dev/null`);
    if (revList) {
      const parts = revList.split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  }

  let diffStat = { files: 0, insertions: 0, deletions: 0 };
  if (branch !== 'main' && branch !== 'master') {
    const base = exec('git rev-parse --verify origin/main 2>/dev/null') ? 'origin/main' : 'origin/master';
    const stat = exec(`git diff --shortstat ${base}...${ref} 2>/dev/null`);
    if (stat) {
      const fm = stat.match(/(\d+) file/); const im = stat.match(/(\d+) insertion/); const dm = stat.match(/(\d+) deletion/);
      diffStat = { files: fm ? +fm[1] : 0, insertions: im ? +im[1] : 0, deletions: dm ? +dm[1] : 0 };
    }
  }

  return {
    name: branch, lastCommit: commitMsg || '-', lastCommitDate: date || '-',
    author: author || '-', ahead, behind, diffStat, isCurrent: branch === currentBranch,
  };
}

export async function GET() {
  exec('git fetch origin 2>/dev/null');
  const currentBranch = exec('git branch --show-current 2>/dev/null') || 'unknown';
  const branches = getRemoteBranches();
  const infos = branches.map(b => getBranchInfo(b, currentBranch));

  // Sort: main first, then by ahead desc
  infos.sort((a, b) => {
    if (a.name === 'main' || a.name === 'master') return -1;
    if (b.name === 'main' || b.name === 'master') return 1;
    return b.ahead - a.ahead;
  });

  const totalCommitsAhead = infos.reduce((s, b) => s + b.ahead, 0);
  return NextResponse.json({ branches: infos, currentBranch, totalBranches: infos.length, totalCommitsAhead });
}
