import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(JHT_HOME, 'sessions')
const SESSIONS_PATH = path.join(JHT_DIR, 'sessions.json')

type SessionState = 'active' | 'paused' | 'ended'
type SessionEntry = {
  id: string; label?: string; channelId: string; chatType: string; state: SessionState
  provider?: string; model?: string; userId?: string; context?: Record<string, unknown>
  createdAtMs: number; updatedAtMs: number; lastMessageAtMs?: number; messageCount: number
}
type Message = { messageId?: string; role: 'user' | 'assistant' | 'system'; text: string; timestamp: number; meta?: Record<string, unknown> }
type SessionStore = { version: number; sessions: SessionEntry[] }

function loadStore(): SessionStore {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'))
    return Array.isArray(raw?.sessions) ? raw : { version: 1, sessions: [] }
  } catch { return { version: 1, sessions: [] } }
}

function saveStore(store: SessionStore) {
  fs.mkdirSync(JHT_DIR, { recursive: true })
  const tmp = SESSIONS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, SESSIONS_PATH)
}

function loadTranscript(sessionId: string): Message[] {
  const paths = [
    path.join(JHT_DIR, `${sessionId}.jsonl`),
    path.join(JHT_DIR, 'transcripts', `${sessionId}.jsonl`),
  ]
  for (const p of paths) {
    try {
      const lines = fs.readFileSync(p, 'utf-8').trim().split('\n')
      return lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { continue }
  }
  return []
}

type RouteCtx = { params: Promise<{ id: string }> }

/** GET /api/sessions/[id] — dettaglio sessione con transcript */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const denied = await requireAuth()
  if (denied) return denied
  const { id } = await ctx.params
  const store = loadStore()
  const session = store.sessions.find(s => s.id === id)
  if (!session) return NextResponse.json({ ok: false, error: 'Sessione non trovata' }, { status: 404 })

  const messages = loadTranscript(id)
  const durationMs = (session.lastMessageAtMs ?? session.updatedAtMs) - session.createdAtMs

  return NextResponse.json({
    ...session, messages, durationMs,
    messageCount: messages.length || session.messageCount,
  })
}

/** PATCH /api/sessions/[id] — aggiorna stato: { state: "paused"|"ended"|"active", reason? } */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const denied = await requireAuth()
  if (denied) return denied
  const { id } = await ctx.params
  let body: { state?: SessionState; reason?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.state || !['active', 'paused', 'ended'].includes(body.state)) {
    return NextResponse.json({ ok: false, error: 'state non valido' }, { status: 400 })
  }
  const store = loadStore()
  const session = store.sessions.find(s => s.id === id)
  if (!session) return NextResponse.json({ ok: false, error: 'Sessione non trovata' }, { status: 404 })

  session.state = body.state
  session.updatedAtMs = Date.now()
  saveStore(store)
  return NextResponse.json({ ok: true, id, state: body.state })
}
