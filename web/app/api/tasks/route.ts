import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const TASKS_PATH = path.join(JHT_HOME, 'tasks', 'tasks.json')

type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'lost'
type TaskRuntime = 'subagent' | 'cli' | 'cron'

interface TaskRecord {
  taskId: string
  runtime: TaskRuntime
  ownerKey: string
  agentId?: string
  label?: string
  task: string
  status: TaskStatus
  createdAt: number
  startedAt?: number
  endedAt?: number
  progressSummary?: string
  error?: string
}

interface TaskStore { version: 1; updatedAt: number; tasks: TaskRecord[] }

const ACTIVE: ReadonlySet<TaskStatus> = new Set(['queued', 'running'])
const TERMINAL: ReadonlySet<TaskStatus> = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'lost'])

function load(): TaskStore {
  try {
    const raw = fs.readFileSync(TASKS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as TaskStore
    return Array.isArray(parsed?.tasks) ? parsed : { version: 1, updatedAt: Date.now(), tasks: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { version: 1, updatedAt: Date.now(), tasks: [] }
    throw e
  }
}

function save(store: TaskStore): void {
  fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true })
  const tmp = TASKS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ...store, updatedAt: Date.now() }, null, 2), 'utf-8')
  fs.renameSync(tmp, TASKS_PATH)
}

/** GET — lista task con filtro opzionale: ?status=running|active|terminal */
export async function GET(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  const filter = req.nextUrl.searchParams.get('status')
  const store = load()
  const tasks = store.tasks.filter(t => {
    if (!filter) return true
    if (filter === 'active') return ACTIVE.has(t.status)
    if (filter === 'terminal') return TERMINAL.has(t.status)
    return t.status === filter
  }).sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ tasks, total: tasks.length })
}

/** POST — crea nuovo task */
export async function POST(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  let body: { task?: string; agentId?: string; label?: string; runtime?: TaskRuntime } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.task?.trim()) {
    return NextResponse.json({ ok: false, error: 'task obbligatorio' }, { status: 400 })
  }
  const record: TaskRecord = {
    taskId: randomUUID(),
    runtime: body.runtime ?? 'cli',
    ownerKey: 'web',
    agentId: body.agentId,
    label: body.label,
    task: body.task.trim(),
    status: 'queued',
    createdAt: Date.now(),
  }
  const store = load()
  store.tasks.push(record)
  save(store)
  return NextResponse.json({ ok: true, task: record }, { status: 201 })
}

/** PATCH — aggiorna stato task (?id=xxx body: { status }) */
export async function PATCH(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })
  let body: { status?: TaskStatus } = {}
  try { body = await req.json() } catch { /* ignore */ }
  const store = load()
  const task = store.tasks.find(t => t.taskId === id)
  if (!task) return NextResponse.json({ ok: false, error: 'task non trovato' }, { status: 404 })
  if (body.status) {
    task.status = body.status
    if (TERMINAL.has(body.status)) task.endedAt = Date.now()
  }
  save(store)
  return NextResponse.json({ ok: true, task })
}
