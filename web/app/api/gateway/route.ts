import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

type ChannelId = 'web' | 'telegram' | 'cli'

const GATEWAY_URL = process.env.JHT_GATEWAY_URL ?? 'http://localhost:18789'
const TIMEOUT_MS = 5_000

const DEFAULT_CONFIG = { port: 18789, channels: ['web', 'cli'] as ChannelId[], requestTimeoutMs: 120_000, maxQueueSize: 100 }

function loadGatewayConfig(): typeof DEFAULT_CONFIG & { channels: ChannelId[] } {
  const candidates = [
    path.join(JHT_HOME, 'jht.config.json'),
    path.join(process.cwd(), 'jht.config.json'),
    path.join(process.cwd(), '..', 'jht.config.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'))
        if (cfg.gateway) return { ...DEFAULT_CONFIG, ...cfg.gateway }
      }
    } catch { /* continua */ }
  }
  return DEFAULT_CONFIG
}

async function probeGateway(url: string): Promise<{ reachable: boolean; ms: number; statusCode?: number; data?: unknown }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${url}/status`, { signal: controller.signal, headers: { 'User-Agent': 'jht-web/1.0' } })
    clearTimeout(timer)
    const ms = Date.now() - start
    const data = res.ok ? await res.json().catch(() => null) : null
    return { reachable: res.status < 500, ms, statusCode: res.status, data }
  } catch {
    const ms = Date.now() - start
    return { reachable: false, ms }
  }
}

async function checkTmuxSession(session: string): Promise<boolean> {
  const { stdout } = await runBash(`tmux has-session -t "${session}" 2>&1 && echo EXISTS || echo NONE`).catch(() => ({ stdout: 'NONE' }))
  return stdout.trim() === 'EXISTS'
}

const CHANNEL_SESSIONS: Record<ChannelId, string> = {
  web: 'JHT-WEB',
  telegram: 'JHT-BOT',
  cli: 'JHT-CLI',
}

export async function GET() {
  const config = loadGatewayConfig()
  const [probe, telegramActive] = await Promise.all([
    probeGateway(GATEWAY_URL),
    checkTmuxSession(CHANNEL_SESSIONS.telegram),
  ])

  // Stato canali: web sempre up se gateway raggiungibile, telegram da tmux, cli da processo
  const channels = config.channels.map(id => ({
    id,
    connected: id === 'web' ? probe.reachable : id === 'telegram' ? telegramActive : probe.reachable,
    label: { web: 'Web Dashboard', telegram: 'Telegram Bot', cli: 'CLI' }[id] ?? id,
  }))

  // Middleware registrati (info statica da shared/gateway/)
  const middleware = [
    { name: 'rate-limiter', phase: 'pre',  priority: 10, description: 'Limita richieste per canale' },
    { name: 'auth',         phase: 'pre',  priority: 20, description: 'Verifica identità mittente' },
    { name: 'logger',       phase: 'pre',  priority: 30, description: 'Log messaggi in ingresso' },
    { name: 'logger',       phase: 'post', priority: 10, description: 'Log risposte in uscita' },
  ]

  return NextResponse.json({
    reachable: probe.reachable,
    url: GATEWAY_URL,
    latencyMs: probe.ms,
    channels,
    config,
    middleware,
    remoteStatus: probe.data ?? null,
    ts: Date.now(),
  })
}
