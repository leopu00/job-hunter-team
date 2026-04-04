import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')
const TASKS_PATH = path.join(JHT_DIR, 'tasks', 'tasks.json')
const EVENTS_PATH = path.join(JHT_DIR, 'tasks', 'events.jsonl')

type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'lost'
type TaskRecord = {
  taskId: string; runtime: string; ownerKey: string; agentId?: string; label?: string
  task: string; status: TaskStatus; createdAt: number; startedAt?: number; endedAt?: number
  progressSummary?: string; error?: string
}
type TaskStore = { version: number; updatedAt: number; tasks: TaskRecord[] }
type TaskEvent = { taskId: string; kind: string; timestamp: number; detail?: string }

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function loadTask(id: string): TaskRecord | null {
  const store = readJsonSafe<TaskStore>(TASKS_PATH)
  if (!store?.tasks) return null
  return store.tasks.find(t => t.taskId === id) ?? null
}

function loadEvents(taskId: string): TaskEvent[] {
  try {
    const lines = fs.readFileSync(EVENTS_PATH, 'utf-8').trim().split('\n')
    return lines
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter((e): e is TaskEvent => e?.taskId === taskId)
  } catch { return [] }
}

function buildTimeline(task: TaskRecord, events: TaskEvent[]): { ts: number; label: string; status: string }[] {
  const timeline: { ts: number; label: string; status: string }[] = []
  timeline.push({ ts: task.createdAt, label: 'Creato', status: 'queued' })
  if (task.startedAt) timeline.push({ ts: task.startedAt, label: 'Avviato', status: 'running' })
  for (const e of events) {
    if (e.kind === 'retry') timeline.push({ ts: e.timestamp, label: `Retry${e.detail ? ': ' + e.detail : ''}`, status: 'running' })
    else if (e.kind === 'progress') timeline.push({ ts: e.timestamp, label: e.detail ?? 'Progresso', status: 'running' })
    else if (e.kind !== 'created' && e.kind !== 'started') timeline.push({ ts: e.timestamp, label: e.kind, status: e.kind })
  }
  if (task.endedAt) {
    const label = task.status === 'succeeded' ? 'Completato' : task.status === 'failed' ? 'Fallito' : task.status === 'timed_out' ? 'Timeout' : task.status === 'cancelled' ? 'Cancellato' : 'Terminato'
    timeline.push({ ts: task.endedAt, label, status: task.status })
  }
  return timeline.sort((a, b) => a.ts - b.ts)
}

type RouteCtx = { params: Promise<{ id: string }> }

/** GET /api/tasks/[id] — dettaglio task con timeline e eventi */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const task = loadTask(id)
  if (!task) return NextResponse.json({ ok: false, error: 'Task non trovato' }, { status: 404 })

  const events = loadEvents(id)
  const timeline = buildTimeline(task, events)
  const durationMs = task.endedAt ? task.endedAt - task.createdAt : task.startedAt ? Date.now() - task.startedAt : 0

  return NextResponse.json({ ...task, events, timeline, durationMs })
}

/** PATCH /api/tasks/[id] — aggiorna stato task */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  let body: { status?: TaskStatus; progressSummary?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const store = readJsonSafe<TaskStore>(TASKS_PATH)
  if (!store?.tasks) return NextResponse.json({ ok: false, error: 'Store non trovato' }, { status: 500 })
  const task = store.tasks.find(t => t.taskId === id)
  if (!task) return NextResponse.json({ ok: false, error: 'Task non trovato' }, { status: 404 })

  if (body.status) {
    task.status = body.status
    const terminal = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'lost'])
    if (body.status === 'running' && !task.startedAt) task.startedAt = Date.now()
    if (terminal.has(body.status)) task.endedAt = Date.now()
  }
  if (body.progressSummary) task.progressSummary = body.progressSummary
  store.updatedAt = Date.now()
  fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true })
  const tmp = TASKS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, TASKS_PATH)
  return NextResponse.json({ ok: true, task })
}
