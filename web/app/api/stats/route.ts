import { NextResponse } from 'next/server'
import { execSync } from 'node:child_process'

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function hasGit(): boolean {
  return run('git rev-parse --is-inside-work-tree') === 'true'
}

/* Dati statici di fallback per ambienti senza git (Vercel, Docker) */
const FALLBACK = {
  overview: {
    agents: 8,
    languages: 2,
    totalCommits: 500,
    contributors: 10,
    devDays: 280,
    apiRoutes: 100,
    pages: 300,
    sharedModules: 36,
    e2eTests: 30,
    firstCommit: '2025-07-01',
    lastCommit: new Date().toISOString().slice(0, 10),
  },
  weeklyCommits: [],
  typeCounts: { feat: 180, fix: 90, merge: 120, test: 30, other: 80 },
  areas: { web: 300, api: 100, shared: 36, e2e: 30 },
  recentCommits: [] as { hash: string; date: string; message: string; author: string }[],
  topContributors: [] as { name: string; commits: number }[],
  dailyCommits: [] as { date: string; count: number }[],
}

export async function GET() {
  if (!hasGit()) {
    return NextResponse.json({ ok: true, source: 'static', ...FALLBACK })
  }

  // Commit count totale
  const totalCommits = parseInt(run('git rev-list --count HEAD'), 10) || 0

  // Commit per settimana (ultime 12 settimane)
  const weeklyRaw = run('git log --since="12 weeks ago" --format="%aI" HEAD')
  const weekMap = new Map<string, number>()
  for (const line of weeklyRaw.split('\n').filter(Boolean)) {
    const d = new Date(line)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    const key = weekStart.toISOString().slice(0, 10)
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1)
  }
  const weeklyCommits = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }))

  // Commit per tipo (ultime 200)
  const typeRaw = run('git log --format="%s" -200 HEAD')
  const typeCounts = { feat: 0, fix: 0, merge: 0, test: 0, other: 0 }
  for (const line of typeRaw.split('\n').filter(Boolean)) {
    if (/^feat/i.test(line)) typeCounts.feat++
    else if (/^fix/i.test(line)) typeCounts.fix++
    else if (/^merge/i.test(line)) typeCounts.merge++
    else if (/^test/i.test(line)) typeCounts.test++
    else typeCounts.other++
  }

  // File count per area
  const areas = {
    web: parseInt(run('find web/app -name "*.tsx" -o -name "*.ts" | wc -l'), 10) || 0,
    api: parseInt(run('find web/app/api -name "route.ts" | wc -l'), 10) || 0,
    shared: parseInt(run('find shared -name "*.ts" 2>/dev/null | wc -l'), 10) || 0,
    e2e: parseInt(run('find e2e -name "*.spec.ts" 2>/dev/null | wc -l'), 10) || 0,
  }

  // Primo e ultimo commit date
  const firstCommitDate = run('git log --reverse --format="%aI" | head -1').slice(0, 10)
  const lastCommitDate = run('git log -1 --format="%aI"').slice(0, 10)

  // Contributori unici
  const contributors = parseInt(run('git log --format="%aN" | sort -u | wc -l'), 10) || 0

  // Ultimi 8 commit
  const recentRaw = run('git log --format="%h|%aI|%s|%aN" -8 HEAD')
  const recentCommits = recentRaw.split('\n').filter(Boolean).map(line => {
    const [hash, date, message, author] = line.split('|')
    return { hash, date: date.slice(0, 10), message, author }
  })

  // Commit giornalieri (ultimi 90 giorni) per heatmap
  const dailyRaw = run('git log --since="90 days ago" --format="%aI" HEAD')
  const dailyMap = new Map<string, number>()
  for (const line of dailyRaw.split('\n').filter(Boolean)) {
    const key = line.slice(0, 10)
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1)
  }
  const dailyCommits = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // Top contributori (commit count per autore)
  const contribRaw = run('git log --format="%aN" HEAD')
  const contribMap = new Map<string, number>()
  for (const name of contribRaw.split('\n').filter(Boolean)) {
    contribMap.set(name, (contribMap.get(name) ?? 0) + 1)
  }
  const topContributors = [...contribMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, commits]) => ({ name, commits }))

  // Giorni di sviluppo
  const first = new Date(firstCommitDate || '2025-07-01')
  const last = new Date(lastCommitDate || new Date().toISOString())
  const devDays = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 86400000))

  return NextResponse.json({
    ok: true,
    source: 'git',
    overview: {
      agents: 8,
      languages: 2,
      totalCommits,
      contributors,
      devDays,
      apiRoutes: areas.api,
      pages: areas.web,
      sharedModules: areas.shared,
      e2eTests: areas.e2e,
      firstCommit: firstCommitDate,
      lastCommit: lastCommitDate,
    },
    weeklyCommits,
    typeCounts,
    areas,
    recentCommits,
    topContributors,
    dailyCommits,
  })
}
