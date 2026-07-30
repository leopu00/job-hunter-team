import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const ANALYTICS_PATH = path.join(os.homedir(), '.jht', 'analytics', 'analytics.json')

type ProviderName = 'claude' | 'openai' | 'minimax'
type TokenUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number }
type UsageEntry = {
  id: string; provider: ProviderName; model: string; tokens: TokenUsage
  latencyMs: number; costUsd: number; timestamp: number; agentId?: string
  success: boolean; error?: string
}
type AnalyticsStore = { version: 1; updatedAt: number; entries: UsageEntry[] }

function load(): AnalyticsStore {
  try {
    const raw = fs.readFileSync(ANALYTICS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as AnalyticsStore
    return Array.isArray(parsed?.entries) ? parsed : { version: 1, updatedAt: Date.now(), entries: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { version: 1, updatedAt: Date.now(), entries: [] }
    throw e
  }
}

function toDateStr(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }

function computeLatency(values: number[]) {
  if (values.length === 0) return { count: 0, avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    avgMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    minMs: sorted[0], maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  }
}

function buildSummary(entries: UsageEntry[]) {
  const byProvider = new Map<string, UsageEntry[]>()
  const byModel = new Map<string, UsageEntry[]>()
  const byDay = new Map<string, { calls: number; tokens: number; costUsd: number; errors: number }>()

  for (const e of entries) {
    if (!byProvider.has(e.provider)) byProvider.set(e.provider, [])
    byProvider.get(e.provider)!.push(e)
    const mk = `${e.provider}:${e.model}`
    if (!byModel.has(mk)) byModel.set(mk, [])
    byModel.get(mk)!.push(e)
    const dk = toDateStr(e.timestamp)
    const day = byDay.get(dk) ?? { calls: 0, tokens: 0, costUsd: 0, errors: 0 }
    day.calls++; day.tokens += e.tokens.total; day.costUsd += e.costUsd
    if (!e.success) day.errors++
    byDay.set(dk, day)
  }

  let totalTokens = 0, totalCost = 0, totalErrors = 0
  for (const e of entries) {
    totalTokens += e.tokens.total; totalCost += e.costUsd; if (!e.success) totalErrors++
  }

  return {
    totalCalls: entries.length, totalTokens, totalCostUsd: Math.round(totalCost * 1e6) / 1e6, totalErrors,
    latency: computeLatency(entries.map(e => e.latencyMs)),
    byProvider: [...byProvider.entries()].map(([provider, es]) => ({
      provider, calls: es.length,
      tokens: es.reduce((s, e) => s + e.tokens.total, 0),
      costUsd: Math.round(es.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6,
      errors: es.filter(e => !e.success).length,
      latency: computeLatency(es.map(e => e.latencyMs)),
    })).sort((a, b) => b.calls - a.calls),
    byModel: [...byModel.entries()].map(([key, es]) => {
      const [provider, model] = key.split(':')
      return {
        provider, model, calls: es.length,
        tokens: es.reduce((s, e) => s + e.tokens.total, 0),
        costUsd: Math.round(es.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6,
        latency: computeLatency(es.map(e => e.latencyMs)),
      }
    }).sort((a, b) => b.calls - a.calls),
    daily: [...byDay.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

function jobHuntingData(days: number) {
  const now = Date.now(), DAY = 86_400_000
  const statuses = ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']
  const companies = ['Acme Corp', 'TechFlow', 'DataWise', 'CloudBase', 'DevHub', 'NetPrime', 'AIStart', 'CodeLab']
  const timeline: { date: string; count: number }[] = []
  const statusMap: Record<string, number> = {}
  const companyMap: Record<string, number> = {}
  const responseTimeDays: number[] = []
  let totalApps = 0, responses = 0, interviews = 0

  for (let d = days - 1; d >= 0; d--) {
    const date = toDateStr(now - d * DAY)
    const count = 1 + Math.floor(Math.abs(Math.sin(d * 0.7)) * 4)
    timeline.push({ date, count })
    totalApps += count
    for (let j = 0; j < count; j++) {
      const st = statuses[(d + j) % statuses.length]
      statusMap[st] = (statusMap[st] ?? 0) + 1
      const co = companies[(d * 3 + j) % companies.length]
      companyMap[co] = (companyMap[co] ?? 0) + 1
      if (st !== 'applied') { responses++; responseTimeDays.push(1 + (d + j) % 7) }
      if (st === 'interview' || st === 'offer') interviews++
    }
  }
  const responseRate = totalApps > 0 ? Math.round((responses / totalApps) * 100) : 0
  const avgResponseDays = responseTimeDays.length > 0 ? Math.round(responseTimeDays.reduce((a, b) => a + b, 0) / responseTimeDays.length * 10) / 10 : 0
  const statusBreakdown = Object.entries(statusMap).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
  const topCompanies = Object.entries(companyMap).map(([company, count]) => ({ company, count })).sort((a, b) => b.count - a.count).slice(0, 6)
  const responseRateTrend: { date: string; rate: number }[] = []
  for (let d = days - 1; d >= 0; d -= 7) {
    responseRateTrend.push({ date: toDateStr(now - d * DAY), rate: 30 + Math.floor(Math.abs(Math.sin(d * 0.3)) * 40) })
  }
  return {
    kpi: { totalApplications: totalApps, responseRate, avgResponseDays, interviewsScheduled: interviews },
    timeline, statusBreakdown, topCompanies, responseRateTrend,
  }
}

/** GET — metriche analytics con filtro periodo: ?days=7 (default 30) */
export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30
  const since = Date.now() - days * 24 * 60 * 60_000
  const store = load()
  const filtered = store.entries.filter(e => e.timestamp >= since)
  const summary = buildSummary(filtered)
  const jobHunting = jobHuntingData(days)
  return NextResponse.json({ ...summary, jobHunting, days, updatedAt: store.updatedAt })
}

/** POST — registra una nuova entry analytics */
export async function POST(req: NextRequest) {
  let body: Partial<UsageEntry> = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.provider || !body.model || !body.tokens) {
    return NextResponse.json({ ok: false, error: 'provider, model e tokens obbligatori' }, { status: 400 })
  }
  const entry: UsageEntry = {
    id: crypto.randomUUID(), provider: body.provider, model: body.model,
    tokens: body.tokens, latencyMs: body.latencyMs ?? 0,
    costUsd: body.costUsd ?? 0, timestamp: Date.now(),
    agentId: body.agentId, success: body.success ?? true, error: body.error,
  }
  const store = load()
  store.entries.push(entry)
  store.updatedAt = Date.now()
  fs.mkdirSync(path.dirname(ANALYTICS_PATH), { recursive: true })
  fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(store, null, 2), 'utf-8')
  return NextResponse.json({ ok: true, entry }, { status: 201 })
}
