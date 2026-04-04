import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const CONFIG_PATH = path.join(os.homedir(), '.jht', 'jht.config.json')
const STATS_PATH = path.join(os.homedir(), '.jht', 'channels', 'stats.json')

type ChannelId = 'web' | 'cli' | 'telegram' | 'email' | 'slack' | 'webhook'

interface ChannelCapabilities {
  markdown: boolean
  streaming: boolean
  attachments: boolean
  push: boolean
}

interface ChannelStats {
  messagesSent: number
  messagesReceived: number
  lastActivityAt: number | null
  errors: number
}

interface ChannelInfo {
  id: ChannelId
  name: string
  description: string
  connected: boolean
  enabled: boolean
  capabilities: ChannelCapabilities
  stats: ChannelStats
  configuredAt: number | null
}

const ENABLED_PATH = path.join(os.homedir(), '.jht', 'channels', 'enabled.json')

function loadEnabled(): Record<string, boolean> {
  try { return JSON.parse(fs.readFileSync(ENABLED_PATH, 'utf-8')) } catch { return {} }
}

function saveEnabled(data: Record<string, boolean>): void {
  const dir = path.dirname(ENABLED_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = ENABLED_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, ENABLED_PATH)
}

const CHANNEL_DEFS: Record<ChannelId, { name: string; description: string; capabilities: ChannelCapabilities }> = {
  web: {
    name: 'Web',
    description: 'Canale web via API HTTP — chat browser, dashboard',
    capabilities: { markdown: true, streaming: true, attachments: true, push: false },
  },
  cli: {
    name: 'CLI',
    description: 'Canale terminale — interazione via riga di comando',
    capabilities: { markdown: false, streaming: true, attachments: false, push: false },
  },
  telegram: {
    name: 'Telegram',
    description: 'Bot Telegram — messaggi, notifiche push, comandi',
    capabilities: { markdown: true, streaming: false, attachments: true, push: true },
  },
  email: {
    name: 'Email',
    description: 'Canale email — notifiche SMTP, risposte via IMAP',
    capabilities: { markdown: true, streaming: false, attachments: true, push: true },
  },
  slack: {
    name: 'Slack',
    description: 'Integrazione Slack — messaggi canale e DM',
    capabilities: { markdown: true, streaming: false, attachments: true, push: true },
  },
  webhook: {
    name: 'Webhook',
    description: 'Webhook HTTP — invio eventi a URL configurati',
    capabilities: { markdown: false, streaming: false, attachments: false, push: true },
  },
}

function loadConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

function loadStats(): Record<string, ChannelStats> {
  try { return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8')) } catch { return {} }
}

function isChannelConfigured(id: ChannelId, config: Record<string, unknown>): boolean {
  if (id === 'web') return true
  if (id === 'cli') return true
  if (id === 'telegram') {
    const tg = config.telegram as Record<string, unknown> | undefined
    return !!(tg?.bot_token || tg?.token)
  }
  if (id === 'email') {
    const em = config.email as Record<string, unknown> | undefined
    return !!(em?.smtp_host || em?.host)
  }
  if (id === 'slack') {
    const sl = config.slack as Record<string, unknown> | undefined
    return !!(sl?.token || sl?.webhook_url)
  }
  if (id === 'webhook') {
    const wh = config.webhooks as Record<string, unknown>[] | undefined
    return Array.isArray(wh) && wh.length > 0
  }
  return false
}

function defaultStats(): ChannelStats {
  return { messagesSent: 0, messagesReceived: 0, lastActivityAt: null, errors: 0 }
}

/** GET — lista canali con stato, capabilities e stats */
export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get('status')
  const config = loadConfig()
  const allStats = loadStats()
  const enabled = loadEnabled()

  const channels: ChannelInfo[] = (Object.keys(CHANNEL_DEFS) as ChannelId[]).map(id => {
    const def = CHANNEL_DEFS[id]
    const connected = isChannelConfigured(id, config)
    const stats = allStats[id] ?? defaultStats()
    return {
      id,
      name: def.name,
      description: def.description,
      connected,
      enabled: enabled[id] !== false,
      capabilities: def.capabilities,
      stats,
      configuredAt: connected ? (allStats[id]?.lastActivityAt ?? null) : null,
    }
  })

  let filtered = channels
  if (filter === 'connected') filtered = channels.filter(c => c.connected)
  if (filter === 'disconnected') filtered = channels.filter(c => !c.connected)

  const connectedCount = channels.filter(c => c.connected).length
  const enabledCount = channels.filter(c => c.enabled).length
  return NextResponse.json({ channels: filtered, total: filtered.length, connectedCount, enabledCount })
}

/** PUT — toggle enable/disable canale */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, enabled: val } = body as { id: string; enabled: boolean }
    if (!id || typeof val !== 'boolean') {
      return NextResponse.json({ error: 'id (string) e enabled (boolean) richiesti' }, { status: 400 })
    }
    if (!(id in CHANNEL_DEFS)) {
      return NextResponse.json({ error: `Canale ${id} non trovato` }, { status: 404 })
    }
    const data = loadEnabled()
    data[id] = val
    saveEnabled(data)
    return NextResponse.json({ ok: true, id, enabled: val })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
