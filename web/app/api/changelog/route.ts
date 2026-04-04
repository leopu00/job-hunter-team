import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'

export const dynamic = 'force-dynamic'

export type CommitType = 'feat' | 'fix' | 'merge' | 'test' | 'other'

export interface CommitEntry {
  hash: string
  date: string
  message: string
  type: CommitType
}

export interface DayGroup {
  date: string
  commits: CommitEntry[]
}

function classifyCommit(message: string): CommitType {
  const lower = message.toLowerCase()
  if (lower.startsWith('merge:') || lower.startsWith('merge(')) return 'merge'
  if (lower.startsWith('feat')) return 'feat'
  if (lower.startsWith('fix')) return 'fix'
  if (lower.startsWith('test')) return 'test'
  return 'other'
}

/** GET — ultime modifiche da git log, raggruppate per data */
export async function GET() {
  try {
    const repoRoot = path.resolve(process.cwd(), '..')
    const raw = execSync(
      'git log origin/master --pretty=format:"%h|%as|%s" -80',
      { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 },
    )

    const commits: CommitEntry[] = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', date = '', ...rest] = line.split('|')
        const message = rest.join('|')
        return { hash, date, message, type: classifyCommit(message) }
      })
      .filter((c) =>
        !c.message.startsWith('Merge remote-tracking') &&
        !c.message.startsWith('Merge branch'),
      )

    // Raggruppa per data
    const groupMap = new Map<string, CommitEntry[]>()
    for (const c of commits) {
      const arr = groupMap.get(c.date) ?? []
      arr.push(c)
      groupMap.set(c.date, arr)
    }
    const days: DayGroup[] = [...groupMap.entries()].map(([date, entries]) => ({ date, commits: entries }))

    return NextResponse.json({ ok: true, days, total: commits.length })
  } catch {
    return NextResponse.json({ ok: false, days: [], total: 0, error: 'Git log non disponibile' })
  }
}
