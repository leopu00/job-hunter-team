import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

type ServiceStatus = 'ok' | 'error' | 'timeout' | 'unknown'

type ServiceHealth = {
  name: string
  url?: string
  ok: boolean
  status: ServiceStatus
  httpStatus?: number
  ms?: number
  error?: string
}

type AgentInfo = { session: string; active: boolean }

const TIMEOUT_MS = 5_000

const HTTP_SERVICES = [
  { name: 'web',     url: process.env.JHT_WEB_URL     ?? 'http://localhost:3000' },
  { name: 'gateway', url: process.env.JHT_GATEWAY_URL ?? 'http://localhost:18789' },
]

const TMUX_SESSIONS = [
  { name: 'bot telegram', session: 'JHT-BOT' },
  { name: 'telegram',     session: 'JHT-TELEGRAM' },
]

const AGENT_SESSIONS = ['ALFA', 'SCOUT-1', 'ANALISTA-1', 'SCORER-1', 'SCRITTORE-1', 'CRITICO', 'SENTINELLA']

async function checkHttp(name: string, url: string): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'jht-health/1.0' } })
    clearTimeout(timer)
    const ms = Date.now() - start
    const ok = res.status < 500
    return { name, url, ok, status: ok ? 'ok' : 'error', httpStatus: res.status, ms }
  } catch (err: any) {
    const ms = Date.now() - start
    const isTimeout = err?.name === 'AbortError'
    return { name, url, ok: false, status: isTimeout ? 'timeout' : 'error', ms, error: err?.message }
  }
}

async function checkTmux(session: string): Promise<boolean> {
  const { stdout } = await runBash(
    `tmux has-session -t "${session}" 2>&1 && echo EXISTS || echo NONE`
  ).catch(() => ({ stdout: 'NONE' }))
  return stdout.trim() === 'EXISTS'
}

export async function GET() {
  const start = Date.now()

  // HTTP health checks in parallelo
  const httpResults = await Promise.all(HTTP_SERVICES.map(s => checkHttp(s.name, s.url)))

  // Tmux checks
  const tmuxResults: ServiceHealth[] = await Promise.all(
    TMUX_SESSIONS.map(async ({ name, session }) => {
      const active = await checkTmux(session)
      return { name, ok: active, status: (active ? 'ok' : 'unknown') as ServiceStatus }
    })
  )

  // Agenti JHT
  const agents: AgentInfo[] = await Promise.all(
    AGENT_SESSIONS.map(async session => ({
      session,
      active: await checkTmux(session),
    }))
  )

  const services = [...httpResults, ...tmuxResults]
  const allOk = services.every(s => s.ok)

  return NextResponse.json({
    ok: allOk,
    ts: Date.now(),
    durationMs: Date.now() - start,
    services,
    agents,
    activeAgents: agents.filter(a => a.active).length,
    totalAgents: agents.length,
  })
}
