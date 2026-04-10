import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const TASKS_DIR  = path.join(os.homedir(), '.jht-dev', 'tasks')
const FORUM_LOG  = path.join(JHT_HOME, 'forum.log')

export type ActivityType = 'merge' | 'pr' | 'task' | 'test' | 'forum' | 'deploy'

export interface ActivityItem {
  id: string
  type: ActivityType
  title: string
  description?: string
  actor?: string
  at: number
}

/** Legge task YAML frontmatter senza dipendenze */
function parseTaskFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const out: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    out[line.slice(0, sep).trim()] = line.slice(sep + 1).trim().replace(/^"|"$/g, '')
  }
  return out
}

function taskToActivity(meta: Record<string, string>): ActivityItem | null {
  const stato = meta['stato'] ?? ''
  if (!['merged', 'pr-ready', 'in-progress'].includes(stato)) return null

  const type: ActivityType = stato === 'merged' ? 'merge' : stato === 'pr-ready' ? 'pr' : 'task'
  const id = meta['id'] ?? ''
  const aggiornato = meta['aggiornato'] ?? ''
  const at = aggiornato ? new Date(aggiornato.replace(' ', 'T')).getTime() : 0
  if (!at || !id) return null

  const assegnato = meta['assegnato_a']?.split('(')[0]?.trim() ?? '—'
  const label: Record<string, string> = { merge: 'Mergiato', 'pr': 'PR pronta', task: 'In corso' }

  return {
    id: `task-${id}-${stato}`,
    type,
    title: `${label[type]}: ${id}`,
    description: (meta['richiesta'] ?? '').slice(0, 80) + ((meta['richiesta'] ?? '').length > 80 ? '…' : ''),
    actor: assegnato,
    at,
  }
}

/** Parsa forum.log — ultime N righe */
function parseForumLog(limit: number): ActivityItem[] {
  try {
    const raw = fs.readFileSync(FORUM_LOG, 'utf-8')
    const lines = raw.trim().split('\n').slice(-limit * 3)
    const items: ActivityItem[] = []
    for (const line of lines) {
      const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (.+)$/)
      if (!m) continue
      const [, ts, actor, msg] = m
      const at = new Date(ts!.replace(' ', 'T')).getTime()
      const type: ActivityType = /test|vitest/.test(msg!) ? 'test' : /deploy|build/.test(msg!) ? 'deploy' : 'forum'
      items.push({ id: `forum-${at}-${actor}`, type, title: msg!.slice(0, 80) + (msg!.length > 80 ? '…' : ''), actor: actor!, at })
    }
    return items.slice(-limit)
  } catch { return [] }
}

/** GET — activity feed paginato */
export async function GET(req: NextRequest) {
  const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page')  ?? '1'))
  const limit = Math.min(50, Math.max(5, parseInt(req.nextUrl.searchParams.get('limit') ?? '20')))
  const type  = req.nextUrl.searchParams.get('type') ?? 'all'

  const items: ActivityItem[] = []

  // Task files
  try {
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const content = fs.readFileSync(path.join(TASKS_DIR, file), 'utf-8')
      const meta = parseTaskFrontmatter(content)
      const item = taskToActivity(meta)
      if (item) items.push(item)
    }
  } catch { /* dir non trovata */ }

  // Forum log
  items.push(...parseForumLog(60))

  // Filtra per tipo
  const filtered = type === 'all' ? items : items.filter(i => i.type === type)

  // Sort desc e pagina
  filtered.sort((a, b) => b.at - a.at)
  const total = filtered.length
  const start = (page - 1) * limit
  const data  = filtered.slice(start, start + limit)

  return NextResponse.json({ items: data, total, page, limit, pages: Math.ceil(total / limit) })
}
