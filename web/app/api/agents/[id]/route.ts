import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')
const AGENTS_DIR = path.join(JHT_DIR, 'agents')
const CONFIG_PATH = path.join(JHT_DIR, 'jht.config.json')
const TASKS_PATH = path.join(JHT_DIR, 'tasks', 'tasks.json')

const KNOWN_AGENTS: Record<string, { name: string; session: string }> = {
  alfa: { name: 'Alfa (Capitano)', session: 'ALFA' },
  scout: { name: 'Scout', session: 'SCOUT-1' },
  analista: { name: 'Analista', session: 'ANALISTA-1' },
  scorer: { name: 'Scorer', session: 'SCORER-1' },
  scrittore: { name: 'Scrittore', session: 'SCRITTORE-1' },
  critico: { name: 'Critico', session: 'CRITICO' },
  sentinella: { name: 'Sentinella', session: 'SENTINELLA' },
  assistente: { name: 'Assistente', session: 'ASSISTENTE' },
}

function isTmuxRunning(session: string): boolean {
  try { execSync(`tmux has-session -t "${session}" 2>/dev/null`, { stdio: 'pipe' }); return true }
  catch { return false }
}

function readJsonSafe<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
  catch { return null }
}

function loadAgentConfig(agentId: string): Record<string, unknown> | null {
  const cfg = readJsonSafe<{ agents?: { list?: Record<string, unknown>[] } }>(CONFIG_PATH)
  if (!cfg?.agents?.list) return null
  return cfg.agents.list.find((a: any) => a.id === agentId) as Record<string, unknown> ?? null
}

function loadAgentLogs(agentId: string, tail: number): { ts: string; level: string; msg: string }[] {
  const agentDir = path.join(AGENTS_DIR, agentId)
  const logFiles = ['agent.log', 'log.jsonl', 'events.jsonl']
  for (const name of logFiles) {
    const logPath = path.join(agentDir, name)
    if (!fs.existsSync(logPath)) continue
    try {
      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').slice(-tail)
      return lines.map(line => {
        try {
          const parsed = JSON.parse(line)
          return { ts: parsed.ts ?? parsed.timestamp ?? '', level: parsed.level ?? 'info', msg: parsed.msg ?? parsed.message ?? line }
        } catch { return { ts: '', level: 'info', msg: line } }
      })
    } catch { continue }
  }
  return []
}

function loadAgentTasks(agentId: string): Record<string, unknown>[] {
  const store = readJsonSafe<{ entries?: Record<string, unknown>[] }>(TASKS_PATH)
  if (!store?.entries) return []
  return store.entries
    .filter((t: any) => t.agentId === agentId)
    .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 50)
}

type RouteCtx = { params: Promise<{ id: string }> }

/** GET /api/agents/[id] — dettaglio agente: config, stato, log, task */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const known = KNOWN_AGENTS[id]
  const tail = parseInt(req.nextUrl.searchParams.get('logs') ?? '100', 10) || 100

  const config = loadAgentConfig(id)
  const status = known ? (isTmuxRunning(known.session) ? 'running' : 'stopped') : 'unknown'
  const logs = loadAgentLogs(id, Math.min(tail, 500))
  const tasks = loadAgentTasks(id)
  const agentDir = path.join(AGENTS_DIR, id)
  const hasDir = fs.existsSync(agentDir)

  return NextResponse.json({
    id,
    name: known?.name ?? config?.name ?? id,
    session: known?.session ?? null,
    status,
    hasDir,
    config: config ?? {},
    logs,
    tasks,
    taskCount: tasks.length,
    logCount: logs.length,
  })
}
