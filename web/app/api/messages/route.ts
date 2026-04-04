import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const STORE_DIR = path.join(os.homedir(), '.jht')
const STORE_PATH = path.join(STORE_DIR, 'messages.json')

interface Message { id: string; body: string; fromMe: boolean; timestamp: number }

interface Thread {
  id: string
  contact: string
  company: string
  starred: boolean
  messages: Message[]
}

interface MsgStore { version: 1; threads: Thread[] }

const SAMPLE: Thread[] = (() => {
  const now = Date.now(), H = 3_600_000, DAY = 86_400_000
  return [
    { id: 't1', contact: 'Laura Bianchi', company: 'TechFlow', starred: true, messages: [
      { id: 'm1', body: 'Buongiorno, ho visto il suo profilo e sarei interessata a fissare un colloquio.', fromMe: false, timestamp: now - 2 * H },
      { id: 'm2', body: 'Grazie Laura! Sono disponibile giovedì o venerdì pomeriggio.', fromMe: true, timestamp: now - H },
      { id: 'm3', body: 'Perfetto, giovedì alle 15:00 va bene? Le mando il link Meet.', fromMe: false, timestamp: now - 30 * 60_000 },
    ]},
    { id: 't2', contact: 'Marco Rossi', company: 'DataWise S.r.l.', starred: false, messages: [
      { id: 'm4', body: 'Salve, abbiamo ricevuto la sua candidatura per Full Stack Developer.', fromMe: false, timestamp: now - DAY - 3 * H },
      { id: 'm5', body: 'Grazie per il riscontro! Resto a disposizione per qualsiasi informazione.', fromMe: true, timestamp: now - DAY - 2 * H },
    ]},
    { id: 't3', contact: 'Sara Verdi', company: 'CloudBase', starred: false, messages: [
      { id: 'm6', body: 'Ciao! Ti scrivo per il ruolo di Backend Engineer. Sei ancora interessato?', fromMe: false, timestamp: now - 2 * DAY },
    ]},
    { id: 't4', contact: 'Andrea Neri', company: 'CodeLab S.p.A.', starred: true, messages: [
      { id: 'm7', body: 'Buongiorno Andrea, volevo aggiornarla sulla mia candidatura.', fromMe: true, timestamp: now - 3 * DAY },
      { id: 'm8', body: 'Salve, stiamo ancora valutando i candidati. La aggiorno entro venerdì.', fromMe: false, timestamp: now - 2 * DAY - 5 * H },
    ]},
    { id: 't5', contact: 'Giulia Conti', company: 'AIStart', starred: false, messages: [
      { id: 'm9', body: 'Grazie per il colloquio di ieri, è stato molto interessante!', fromMe: true, timestamp: now - 4 * DAY },
      { id: 'm10', body: 'Grazie a te! Ti faremo sapere presto.', fromMe: false, timestamp: now - 4 * DAY + 2 * H },
    ]},
  ]
})()

function load(): MsgStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const data = JSON.parse(raw) as MsgStore
    return Array.isArray(data?.threads) ? data : { version: 1, threads: SAMPLE }
  } catch { return { version: 1, threads: SAMPLE } }
}

function save(store: MsgStore) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_PATH)
}

function lastMsg(t: Thread) { return t.messages[t.messages.length - 1] }
function hasUnread(t: Thread) { const m = lastMsg(t); return m && !m.fromMe }

/** GET — lista thread: ?filter=unread|starred, ?threadId=xxx per singolo thread */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const filter = sp.get('filter')
  const threadId = sp.get('threadId')
  const store = load()

  if (threadId) {
    const thread = store.threads.find(t => t.id === threadId)
    return thread ? NextResponse.json({ thread }) : NextResponse.json({ error: 'non trovato' }, { status: 404 })
  }

  let threads = store.threads
  if (filter === 'unread') threads = threads.filter(hasUnread)
  if (filter === 'starred') threads = threads.filter(t => t.starred)
  threads.sort((a, b) => (lastMsg(b)?.timestamp ?? 0) - (lastMsg(a)?.timestamp ?? 0))

  const summary = threads.map(t => {
    const lm = lastMsg(t)
    return { id: t.id, contact: t.contact, company: t.company, starred: t.starred,
      lastMessage: lm?.body?.slice(0, 80) ?? '', lastTimestamp: lm?.timestamp ?? 0,
      unread: hasUnread(t), messageCount: t.messages.length }
  })
  return NextResponse.json({ threads: summary, total: summary.length, unreadCount: store.threads.filter(hasUnread).length })
}

/** POST — nuovo messaggio: { threadId, body } oppure nuovo thread: { contact, company, body } */
export async function POST(req: NextRequest) {
  let body: { threadId?: string; contact?: string; company?: string; body?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: 'body obbligatorio' }, { status: 400 })

  const store = load()
  const msg: Message = { id: randomUUID(), body: body.body.trim(), fromMe: true, timestamp: Date.now() }

  if (body.threadId) {
    const thread = store.threads.find(t => t.id === body.threadId)
    if (!thread) return NextResponse.json({ ok: false, error: 'thread non trovato' }, { status: 404 })
    thread.messages.push(msg)
    save(store)
    return NextResponse.json({ ok: true, message: msg }, { status: 201 })
  }

  if (!body.contact?.trim() || !body.company?.trim()) {
    return NextResponse.json({ ok: false, error: 'contact e company obbligatori per nuovo thread' }, { status: 400 })
  }
  const thread: Thread = { id: randomUUID(), contact: body.contact.trim(), company: body.company.trim(), starred: false, messages: [msg] }
  store.threads.push(thread)
  save(store)
  return NextResponse.json({ ok: true, thread: { id: thread.id }, message: msg }, { status: 201 })
}
