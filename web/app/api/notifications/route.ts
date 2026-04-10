import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const STORE_PATH = path.join(JHT_HOME, 'notifications', 'notifications.json')

type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'
type NotificationChannel = 'desktop' | 'telegram' | 'web'
type NotificationType = 'info' | 'warning' | 'success' | 'error'

interface StoredNotification {
  id: string
  type: NotificationType
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
  return { version: 1, updatedAt: Date.now(), notifications: sampleNotifications() }
}

function sampleNotifications(): StoredNotification[] {
  const now = Date.now()
  return [
    { id: 's1', type: 'success', channel: 'web', title: 'Candidatura inviata', body: 'Cover letter per Frontend Dev @ Acme inviata con successo', priority: 'normal', timestamp: now - 300_000, read: false },
    { id: 's2', type: 'warning', channel: 'web', title: 'API key in scadenza', body: 'La API key Anthropic scade tra 7 giorni — rinnova da /settings', priority: 'high', timestamp: now - 1_800_000, read: false },
    { id: 's3', type: 'info', channel: 'telegram', title: 'Nuovo job match', body: 'Trovate 3 nuove posizioni compatibili col tuo profilo', priority: 'normal', timestamp: now - 3_600_000, read: false },
    { id: 's4', type: 'error', channel: 'web', title: 'Scraping fallito', body: 'LinkedIn rate limit raggiunto — riprovo tra 30 minuti', priority: 'urgent', timestamp: now - 5_400_000, read: false },
    { id: 's5', type: 'success', channel: 'web', title: 'Profilo aggiornato', body: 'CV e competenze aggiornati nel profilo candidato', priority: 'low', timestamp: now - 7_200_000, read: true },
    { id: 's6', type: 'info', channel: 'desktop', title: 'Report settimanale', body: '12 candidature, 3 risposte, 1 colloquio questa settimana', priority: 'normal', timestamp: now - 86_400_000, read: true },
    { id: 's7', type: 'warning', channel: 'web', title: 'Colloquio domani', body: 'Colloquio tecnico con TechCorp alle 10:00 — preparati!', priority: 'high', timestamp: now - 43_200_000, read: false },
    { id: 's8', type: 'error', channel: 'web', title: 'Telegram disconnesso', body: 'Bot Telegram non raggiungibile — verifica il token', priority: 'high', timestamp: now - 172_800_000, read: true },
  ]
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
  const type = sp.get('type') as NotificationType | null
  const unread = sp.get('unread')

  const store = load()
  let items = store.notifications

  if (priority) items = items.filter(n => n.priority === priority)
  if (channel) items = items.filter(n => n.channel === channel)
  if (type) items = items.filter(n => n.type === type)
  if (unread === 'true') items = items.filter(n => !n.read)

  items.sort((a, b) => b.timestamp - a.timestamp)

  const unreadCount = store.notifications.filter(n => !n.read).length
  return NextResponse.json({ notifications: items, total: items.length, unreadCount })
}

/** POST — crea notifica */
export async function POST(req: NextRequest) {
  let body: { title?: string; body?: string; type?: NotificationType; channel?: NotificationChannel; priority?: NotificationPriority; agentId?: string; sessionId?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ ok: false, error: 'title e body obbligatori' }, { status: 400 })
  }

  const notification: StoredNotification = {
    id: randomUUID(),
    type: body.type ?? 'info',
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
