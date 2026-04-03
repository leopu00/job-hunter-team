import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'

const STORE_PATH = path.join(os.homedir(), '.jht', 'notifications', 'notifications.json')

type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'
type NotificationChannel = 'desktop' | 'telegram' | 'web'

interface StoredNotification {
  id: string
  channel: NotificationChannel
  title: string
  body: string
  priority: NotificationPriority
  timestamp: number
  read: boolean
  agentId?: string
  sessionId?: string
  meta?: Record<string, unknown>
}

interface NotificationStore {
  version: 1
  updatedAt: number
  notifications: StoredNotification[]
}

function load(): NotificationStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as NotificationStore
    return Array.isArray(parsed?.notifications) ? parsed : empty()
  } catch (e: any) {
    if (e.code === 'ENOENT') return empty()
    throw e
  }
}

function empty(): NotificationStore {
  return { version: 1, updatedAt: Date.now(), notifications: [] }
}

function save(store: NotificationStore): void {
  const dir = path.dirname(STORE_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ...store, updatedAt: Date.now() }, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_PATH)
}

/** GET — lista notifiche con filtri: ?priority=high&channel=web&unread=true */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const priority = sp.get('priority') as NotificationPriority | null
  const channel = sp.get('channel') as NotificationChannel | null
  const unread = sp.get('unread')

  const store = load()
  let items = store.notifications

  if (priority) items = items.filter(n => n.priority === priority)
  if (channel) items = items.filter(n => n.channel === channel)
  if (unread === 'true') items = items.filter(n => !n.read)

  items.sort((a, b) => b.timestamp - a.timestamp)

  const unreadCount = store.notifications.filter(n => !n.read).length
  return NextResponse.json({ notifications: items, total: items.length, unreadCount })
}

/** POST — crea notifica */
export async function POST(req: NextRequest) {
  let body: { title?: string; body?: string; channel?: NotificationChannel; priority?: NotificationPriority; agentId?: string; sessionId?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ ok: false, error: 'title e body obbligatori' }, { status: 400 })
  }

  const notification: StoredNotification = {
    id: randomUUID(),
    channel: body.channel ?? 'web',
    title: body.title.trim(),
    body: body.body.trim(),
    priority: body.priority ?? 'normal',
    timestamp: Date.now(),
    read: false,
    agentId: body.agentId,
    sessionId: body.sessionId,
  }

  const store = load()
  store.notifications.push(notification)
  save(store)
  return NextResponse.json({ ok: true, notification }, { status: 201 })
}

/** PATCH — mark-as-read: ?id=xxx oppure ?all=true */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const all = req.nextUrl.searchParams.get('all')

  const store = load()

  if (all === 'true') {
    let count = 0
    for (const n of store.notifications) {
      if (!n.read) { n.read = true; count++ }
    }
    save(store)
    return NextResponse.json({ ok: true, markedRead: count })
  }

  if (!id) return NextResponse.json({ ok: false, error: 'id o all obbligatorio' }, { status: 400 })

  const notification = store.notifications.find(n => n.id === id)
  if (!notification) return NextResponse.json({ ok: false, error: 'notifica non trovata' }, { status: 404 })

  notification.read = true
  save(store)
  return NextResponse.json({ ok: true, notification })
}

/** DELETE — elimina notifica: ?id=xxx oppure ?read=true (elimina tutte le lette) */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const readOnly = req.nextUrl.searchParams.get('read')

  const store = load()

  if (readOnly === 'true') {
    const before = store.notifications.length
    store.notifications = store.notifications.filter(n => !n.read)
    save(store)
    return NextResponse.json({ ok: true, deleted: before - store.notifications.length })
  }

  if (!id) return NextResponse.json({ ok: false, error: 'id o read obbligatorio' }, { status: 400 })

  const idx = store.notifications.findIndex(n => n.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'notifica non trovata' }, { status: 404 })

  store.notifications.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
