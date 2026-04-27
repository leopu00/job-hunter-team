import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const JHT_DIR      = JHT_HOME
const HISTORY_PATH = path.join(JHT_DIR, 'history.json')
const HISTORY_DIR  = path.join(JHT_DIR, 'history')

type Message = { role: string; content: string; ts: number; name?: string; meta?: Record<string, unknown> }
type Conversation = {
  id: string; agentId?: string; label?: string
  messages: Message[]; createdAt: number; updatedAt: number
}
type HistoryStore = { version: number; updatedAt: number; conversations: Conversation[] }

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

/** Cerca conversazione in history.json */
function loadFromStore(id: string): Conversation | null {
  const store = readJsonSafe<HistoryStore>(HISTORY_PATH)
  if (!store?.conversations) return null
  return store.conversations.find(c => c.id === id) ?? null
}

/** Cerca transcript JSONL in ~/.jht/history/{id}.jsonl */
function loadFromTranscript(id: string): Conversation | null {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  for (const name of [`${safe}.jsonl`, `${id}.jsonl`]) {
    const fp = path.join(HISTORY_DIR, name)
    if (!fs.existsSync(fp)) continue
    try {
      const lines = fs.readFileSync(fp, 'utf-8').trim().split('\n')
      const messages: Message[] = []
      let label: string | undefined
      let createdAt = 0
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'session') { label = obj.sessionId; createdAt = obj.timestamp ?? 0; continue }
          const msg = obj.message ?? obj
          if (msg.role && msg.content) {
            messages.push({ role: msg.role, content: msg.content, ts: msg.timestamp ?? msg.ts ?? 0, name: msg.name, meta: msg.meta })
          }
        } catch { /* skip malformed */ }
      }
      if (messages.length === 0) continue
      const last = messages[messages.length - 1]
      return { id, agentId: undefined, label, messages, createdAt: createdAt || messages[0]?.ts || 0, updatedAt: last.ts || Date.now() }
    } catch { continue }
  }
  return null
}

type RouteCtx = { params: Promise<{ id: string }> }

/** GET /api/history/[id] — dettaglio conversazione con paginazione messaggi */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const denied = await requireAuth()
  if (denied) return denied
  const { id } = await ctx.params
  const conv = loadFromStore(id) ?? loadFromTranscript(id)
  if (!conv) return NextResponse.json({ ok: false, error: 'Conversazione non trovata' }, { status: 404 })

  const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50))
  const total = conv.messages.length
  const pages = Math.ceil(total / limit) || 1

  // Pagina dall'ultimo (messaggi recenti prima) — page 1 = ultimi N
  const end   = total - (page - 1) * limit
  const start = Math.max(0, end - limit)
  const slice = conv.messages.slice(start, end)

  return NextResponse.json({
    id: conv.id, label: conv.label, agentId: conv.agentId,
    createdAt: conv.createdAt, updatedAt: conv.updatedAt,
    messages: slice, total, page, pages, limit,
  })
}

/** DELETE /api/history/[id] — elimina conversazione */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const denied = await requireAuth()
  if (denied) return denied
  const { id } = await ctx.params
  const store = readJsonSafe<HistoryStore>(HISTORY_PATH)
  if (!store?.conversations) return NextResponse.json({ ok: false, error: 'Store non trovato' }, { status: 500 })
  const before = store.conversations.length
  store.conversations = store.conversations.filter(c => c.id !== id)
  if (store.conversations.length === before) return NextResponse.json({ ok: false, error: 'Non trovata' }, { status: 404 })
  store.updatedAt = Date.now()
  const tmp = HISTORY_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, HISTORY_PATH)
  return NextResponse.json({ ok: true })
}
