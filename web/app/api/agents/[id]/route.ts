import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const JHT_DIR    = JHT_HOME
const AGENTS_DIR = path.join(JHT_DIR, 'agents')
const CONFIG_PATH = path.join(JHT_DIR, 'jht.config.json')
const TASKS_PATH  = path.join(JHT_DIR, 'tasks', 'tasks.json')

// Mappa role-id → info agente
const AGENTS_BY_ID: Record<string, { name: string; session: string; effort: string }> = {
  capitano:       { name: 'Capitano',  session: 'CAPITANO',        effort: 'high' },
  scout:      { name: 'Scout',           session: 'SCOUT-1',     effort: 'high' },
  analista:   { name: 'Analista',        session: 'ANALISTA-1',  effort: 'high' },
  scorer:     { name: 'Scorer',          session: 'SCORER-1',    effort: 'medium' },
  scrittore:  { name: 'Scrittore',       session: 'SCRITTORE-1', effort: 'high' },
  critico:    { name: 'Critico',         session: 'CRITICO',     effort: 'high' },
  sentinella: { name: 'Sentinella',      session: 'SENTINELLA',  effort: 'low' },
  assistente: { name: 'Assistente',      session: 'ASSISTENTE',  effort: 'high' },
}

// Mappa session-name → role-id (lookup inverso per compatibilità con agents/page.tsx)
const AGENTS_BY_SESSION: Record<string, string> = Object.fromEntries(
  Object.entries(AGENTS_BY_ID).map(([id, { session }]) => [session, id])
)

function resolve(param: string): { id: string; info: typeof AGENTS_BY_ID[string] } | null {
  if (AGENTS_BY_ID[param])      return { id: param,               info: AGENTS_BY_ID[param] }
  const roleId = AGENTS_BY_SESSION[param]
  if (roleId && AGENTS_BY_ID[roleId]) return { id: roleId, info: AGENTS_BY_ID[roleId] }
  return null
}

function isTmuxRunning(session: string): boolean {
  try { execSync(`tmux has-session -t "${session}" 2>/dev/null`, { stdio: 'pipe' }); return true }
  catch { return false }
}

function readJsonSafe<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { return null }
}

function loadAgentConfig(agentId: string): Record<string, unknown> | null {
  const cfg = readJsonSafe<{ agents?: { list?: Record<string, unknown>[] } }>(CONFIG_PATH)
  return cfg?.agents?.list?.find((a: any) => a.id === agentId) as Record<string, unknown> ?? null
}

function loadAgentLogs(agentId: string, tail: number): { ts: string; level: string; msg: string }[] {
  const agentDir = path.join(AGENTS_DIR, agentId)
  for (const name of ['agent.log', 'log.jsonl', 'events.jsonl']) {
    const logPath = path.join(agentDir, name)
    if (!fs.existsSync(logPath)) continue
    try {
      return fs.readFileSync(logPath, 'utf-8').trim().split('\n').slice(-tail).map(line => {
        try { const p = JSON.parse(line); return { ts: p.ts ?? p.timestamp ?? '', level: p.level ?? 'info', msg: p.msg ?? p.message ?? line } }
        catch { return { ts: '', level: 'info', msg: line } }
      })
    } catch { continue }
  }
  return []
}

function loadAgentTasks(agentId: string): Record<string, unknown>[] {
  const store = readJsonSafe<{ entries?: Record<string, unknown>[] }>(TASKS_PATH)
  if (!store?.entries) return []
  return store.entries.filter((t: any) => t.agentId === agentId)
    .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 50)
}

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const resolved = resolve(id)
  const tail = parseInt(req.nextUrl.searchParams.get('logs') ?? '100', 10) || 100
  const config = loadAgentConfig(resolved?.id ?? id)
  const status = resolved ? (isTmuxRunning(resolved.info.session) ? 'running' : 'stopped') : 'unknown'
  const logs = loadAgentLogs(resolved?.id ?? id, Math.min(tail, 500))
  const tasks = loadAgentTasks(resolved?.id ?? id)
  const agentDir = path.join(AGENTS_DIR, resolved?.id ?? id)
  return NextResponse.json({
    id: resolved?.id ?? id, name: resolved?.info.name ?? config?.name ?? id,
    session: resolved?.info.session ?? null, status,
    hasDir: fs.existsSync(agentDir), config: config ?? {}, logs, tasks,
    taskCount: tasks.length, logCount: logs.length,
  })
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as { action?: string; workspaceDir?: string }
  const resolved = resolve(id)
  if (!resolved) return NextResponse.json({ ok: false, error: 'Agente sconosciuto' }, { status: 400 })
  const { session, effort } = resolved.info
  const action = body.action

  if (action === 'stop') {
    if (!isTmuxRunning(session)) return NextResponse.json({ ok: true, status: 'not_active' })
    await runBash(`tmux kill-session -t "${session}"`)
    return NextResponse.json({ ok: true, status: 'killed' })
  }
  if (action === 'start') {
    if (isTmuxRunning(session)) return NextResponse.json({ ok: true, status: 'already_active' })
    const dir = body.workspaceDir ?? process.cwd()
    await runBash(`tmux new-session -d -s "${session}" -c "${dir}"`)
    await runBash(`tmux send-keys -t "${session}" "claude --dangerously-skip-permissions --effort ${effort}" C-m`)
    runBash(`(sleep 4 && tmux send-keys -t "${session}" Enter && sleep 3 && tmux send-keys -t "${session}" Enter) &>/dev/null &`).catch(() => {})
    return NextResponse.json({ ok: true, status: 'started' })
  }
  return NextResponse.json({ ok: false, error: 'Azione non valida' }, { status: 400 })
}
