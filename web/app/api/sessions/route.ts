import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'

const SESSIONS_PATH = path.join(os.homedir(), '.jht', 'sessions', 'sessions.json')

type SessionState = 'active' | 'paused' | 'ended'

interface SessionEntry {
  id: string
  label?: string
  channelId: string
  chatType: 'direct' | 'group' | 'channel'
  state: SessionState
  provider?: string
  model?: string
  userId?: string
  context?: Record<string, unknown>
  createdAtMs: number
  updatedAtMs: number
  lastMessageAtMs?: number
  messageCount: number
}

interface SessionStore {
  version: number
  sessions: SessionEntry[]
}

function loadStore(): SessionStore {
  try {
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as SessionStore
    if (!parsed?.sessions) return { version: 1, sessions: [] }
    return parsed
  } catch (err: any) {
    if (err.code === 'ENOENT') return { version: 1, sessions: [] }
    throw err
  }
}

function saveStore(store: SessionStore): void {
  fs.mkdirSync(path.dirname(SESSIONS_PATH), { recursive: true })
  const tmp = SESSIONS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, SESSIONS_PATH)
}

/** GET — lista sessioni con filtro opzionale per stato */
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state') as SessionState | null
  const store = loadStore()
  const sessions = state
    ? store.sessions.filter(s => s.state === state)
    : store.sessions
  return NextResponse.json({ sessions, total: sessions.length })
}

/** POST — crea nuova sessione */
export async function POST(req: NextRequest) {
  let body: { channelId?: string; label?: string; userId?: string; provider?: string; model?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const channelId = (body.channelId ?? 'web').trim()
  const now = Date.now()
  const session: SessionEntry = {
    id: randomUUID(),
    label: body.label,
    channelId,
    chatType: 'direct',
    state: 'active',
    provider: body.provider,
    model: body.model,
    userId: body.userId,
    createdAtMs: now,
    updatedAtMs: now,
    messageCount: 0,
  }
  const store = loadStore()
  store.sessions.push(session)
  saveStore(store)
  return NextResponse.json({ ok: true, session }, { status: 201 })
}

/** DELETE — termina sessione per ID */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const store = loadStore()
  const idx = store.sessions.findIndex(s => s.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'sessione non trovata' }, { status: 404 })

  store.sessions[idx]!.state = 'ended'
  store.sessions[idx]!.updatedAtMs = Date.now()
  saveStore(store)
  return NextResponse.json({ ok: true })
}
