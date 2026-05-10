import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const JHT_DIR        = JHT_HOME
const TASKS_PATH     = path.join(JHT_DIR, 'tasks', 'tasks.json')
const ANALYTICS_PATH = path.join(JHT_DIR, 'analytics', 'analytics.json')

const AGENT_IDS = ['capitano', 'scout', 'analista', 'scorer', 'scrittore', 'critico', 'assistente']

type TaskRecord = {
  taskId: string; agentId?: string; status: string
  createdAt: number; startedAt?: number; endedAt?: number
}
type TaskStore = { version: number; tasks: TaskRecord[] }
type UsageEntry = {
  agentId?: string; tokens: { total: number }; latencyMs: number
  costUsd: number; timestamp: number; success: boolean
}
type AnalyticsStore = { entries: UsageEntry[] }

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

type AgentMetrics = {
  agentId: string; tasks: { total: number; succeeded: number; failed: number; running: number; avgDurationMs: number }
  api: { calls: number; tokens: number; costUsd: number; errors: number; avgLatencyMs: number }
  successRate: number; score: number
}

function computeAgentMetrics(agentId: string, tasks: TaskRecord[], entries: UsageEntry[]): AgentMetrics {
  const agentTasks = tasks.filter(t => t.agentId === agentId)
  const succeeded = agentTasks.filter(t => t.status === 'succeeded')
  const failed = agentTasks.filter(t => t.status === 'failed')
  const running = agentTasks.filter(t => t.status === 'running')

  const durations = agentTasks
    .filter(t => t.startedAt && t.endedAt)
    .map(t => t.endedAt! - t.startedAt!)
  const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  const agentEntries = entries.filter(e => e.agentId === agentId)
  const totalTokens = agentEntries.reduce((s, e) => s + (e.tokens?.total ?? 0), 0)
  const totalCost = agentEntries.reduce((s, e) => s + (e.costUsd ?? 0), 0)
  const errors = agentEntries.filter(e => !e.success).length
  const latencies = agentEntries.map(e => e.latencyMs).filter(Boolean)
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

  const total = agentTasks.length
  const successRate = total > 0 ? Math.round((succeeded.length / total) * 100) : 0
  // Score composito: success rate pesato + penalità errori API
  const apiErrorRate = agentEntries.length > 0 ? errors / agentEntries.length : 0
  const score = Math.max(0, Math.min(100, Math.round(successRate * 0.7 + (1 - apiErrorRate) * 30)))

  return {
    agentId,
    tasks: { total, succeeded: succeeded.length, failed: failed.length, running: running.length, avgDurationMs },
    api: { calls: agentEntries.length, tokens: totalTokens, costUsd: Math.round(totalCost * 1e4) / 1e4, errors, avgLatencyMs },
    successRate, score,
  }
}

/** GET /api/agents/metrics — metriche aggregate per agente, ?days=30 */
export async function GET(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30))
  const since = Date.now() - days * 86_400_000

  const taskStore = readJsonSafe<TaskStore>(TASKS_PATH)
  const tasks = (taskStore?.tasks ?? []).filter(t => t.createdAt >= since)

  const analyticsStore = readJsonSafe<AnalyticsStore>(ANALYTICS_PATH)
  const entries = (analyticsStore?.entries ?? []).filter(e => e.timestamp >= since)

  const agents = AGENT_IDS.map(id => computeAgentMetrics(id, tasks, entries))
  const active = agents.filter(a => a.tasks.total > 0 || a.api.calls > 0)

  const totals = {
    tasks: tasks.length,
    apiCalls: entries.length,
    tokens: entries.reduce((s, e) => s + (e.tokens?.total ?? 0), 0),
    costUsd: Math.round(entries.reduce((s, e) => s + (e.costUsd ?? 0), 0) * 1e4) / 1e4,
    errors: entries.filter(e => !e.success).length,
  }

  return NextResponse.json({ agents, totals, days, activeCount: active.length })
}
