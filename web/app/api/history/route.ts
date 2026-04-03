import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const HISTORY_DIR  = path.join(os.homedir(), '.jht')
const HISTORY_PATH = path.join(HISTORY_DIR, 'history.json')

type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

type Conversation = {
  id: string
  agentId?: string
  label?: string
  messages: ConversationMessage[]
  createdAt: number
  updatedAt: number
}

type HistoryStore = { version: 1; updatedAt: number; conversations: Conversation[] }

function load(): HistoryStore {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8')
    const data = JSON.parse(raw) as HistoryStore
    return Array.isArray(data?.conversations) ? data : { version: 1, updatedAt: Date.now(), conversations: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { version: 1, updatedAt: Date.now(), conversations: [] }
    throw e
  }
}

function save(store: HistoryStore): void {
  fs.mkdirSync(HISTORY_DIR, { recursive: true })
  const tmp = HISTORY_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ...store, updatedAt: Date.now() }, null, 2), 'utf-8')
  fs.renameSync(tmp, HISTORY_PATH)
}

/** GET — lista conversazioni, opzionale ?agentId=xxx */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')
  const store   = load()
  let convs     = store.conversations
  if (agentId) convs = convs.filter(c => c.agentId === agentId)
  convs = convs.sort((a, b) => b.updatedAt - a.updatedAt)
  return NextResponse.json({ conversations: convs, total: convs.length })
}

/** POST — crea nuova conversazione o aggiunge messaggio a esistente */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const store = load()
  const now   = Date.now()

  // Aggiungi messaggio a conversazione esistente
  const existingId = body.conversationId ? String(body.conversationId) : null
  if (existingId) {
    const conv = store.conversations.find(c => c.id === existingId)
    if (!conv) return NextResponse.json({ error: 'conversazione non trovata' }, { status: 404 })
    const role    = body.role === 'assistant' ? 'assistant' : 'user'
    const content = String(body.content ?? '').trim()
    if (!content) return NextResponse.json({ error: 'content obbligatorio' }, { status: 400 })
    conv.messages.push({ role, content, ts: now })
    conv.updatedAt = now
    save(store)
    return NextResponse.json({ conversation: conv })
  }

  // Crea nuova conversazione
  const conv: Conversation = {
    id:        randomUUID(),
    agentId:   body.agentId ? String(body.agentId).trim() : undefined,
    label:     body.label   ? String(body.label).trim()   : undefined,
    messages:  [],
    createdAt: now,
    updatedAt: now,
  }
  store.conversations.push(conv)
  save(store)
  return NextResponse.json({ conversation: conv }, { status: 201 })
}

/** DELETE — elimina conversazione per id */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obbligatorio' }, { status: 400 })
  try {
    const store  = load()
    const before = store.conversations.length
    store.conversations = store.conversations.filter(c => c.id !== id)
    if (store.conversations.length === before) {
      return NextResponse.json({ error: 'conversazione non trovata' }, { status: 404 })
    }
    save(store)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'errore' }, { status: 500 })
  }
}
