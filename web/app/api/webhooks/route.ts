import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { JHT_HOME } from '@/lib/jht-paths'
import { sanitizedError } from '@/lib/error-response'
import { safeFetch, SsrFBlockedError, userControlledFetchOptions } from '@/lib/ssrf'

export const dynamic = 'force-dynamic'

const WEBHOOKS_PATH = path.join(JHT_HOME, 'webhooks.json')

export type WebhookEvent =
  | 'task.completed' | 'task.failed' | 'session.started' | 'session.ended'
  | 'agent.started'  | 'agent.stopped' | 'backup.completed' | 'deploy.completed'

export interface Webhook {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  enabled: boolean
  secret?: string
  createdAt: number
  lastTriggeredAt?: number
  lastStatus?: number
}

interface WebhookStore { version: number; webhooks: Webhook[] }

function load(): WebhookStore {
  try {
    const p = JSON.parse(fs.readFileSync(WEBHOOKS_PATH, 'utf-8')) as WebhookStore
    return p?.webhooks ? p : { version: 1, webhooks: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { version: 1, webhooks: [] }
    throw e
  }
}

function save(store: WebhookStore): void {
  fs.mkdirSync(path.dirname(WEBHOOKS_PATH), { recursive: true })
  const tmp = WEBHOOKS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, WEBHOOKS_PATH)
}

/** GET — lista webhook */
export async function GET() {
  const store = load()
  return NextResponse.json({ webhooks: store.webhooks, total: store.webhooks.length })
}

/** POST — crea webhook o esegui test ping */
export async function POST(req: NextRequest) {
  let body: { name?: string; url?: string; events?: WebhookEvent[]; secret?: string; action?: string; id?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  // Test ping
  if (body.action === 'test') {
    const store = load()
    const wh = store.webhooks.find(w => w.id === body.id)
    if (!wh) return NextResponse.json({ ok: false, error: 'webhook non trovato' }, { status: 404 })
    try {
      const { response: res } = await safeFetch(
        wh.url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-JHT-Event': 'ping' },
          body: JSON.stringify({ event: 'ping', webhookId: wh.id, timestamp: Date.now() }),
        },
        userControlledFetchOptions('webhooks.test'),
      )
      wh.lastTriggeredAt = Date.now()
      wh.lastStatus = res.status
      save(store)
      return NextResponse.json({ ok: true, status: res.status })
    } catch (err) {
      if (err instanceof SsrFBlockedError) {
        return NextResponse.json(
          { ok: false, error: 'webhook URL blocked by security policy' },
          { status: 400 },
        )
      }
      return sanitizedError(err, { scope: 'webhooks', status: 502, publicMessage: 'timeout' })
    }
  }

  // Crea nuovo webhook
  const url = body.url?.trim()
  const name = body.name?.trim()
  if (!url || !name) return NextResponse.json({ ok: false, error: 'name e url obbligatori' }, { status: 400 })

  const webhook: Webhook = {
    id: randomUUID(), name, url,
    events: body.events ?? [],
    enabled: true,
    secret: body.secret?.trim() || undefined,
    createdAt: Date.now(),
  }
  const store = load()
  store.webhooks.push(webhook)
  save(store)
  return NextResponse.json({ ok: true, webhook }, { status: 201 })
}

/** PUT — aggiorna webhook */
export async function PUT(req: NextRequest) {
  let body: Partial<Webhook> & { id?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const store = load()
  const idx = store.webhooks.findIndex(w => w.id === body.id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'webhook non trovato' }, { status: 404 })

  const { id: _, createdAt: __, ...fields } = body
  Object.assign(store.webhooks[idx]!, fields)
  save(store)
  return NextResponse.json({ ok: true, webhook: store.webhooks[idx] })
}

/** DELETE — elimina webhook */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const store = load()
  const idx = store.webhooks.findIndex(w => w.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'webhook non trovato' }, { status: 404 })

  store.webhooks.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
