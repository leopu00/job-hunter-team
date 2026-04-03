import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const QUEUE_PATH = path.join(os.homedir(), '.jht', 'queue', 'queue-state.json')

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
type JobPriority = 'low' | 'normal' | 'high' | 'critical'

interface JobRecord {
  id: string
  name: string
  priority: JobPriority
  status: JobStatus
  attempts: number
  maxAttempts: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  nextRetryAt?: number
  lastError?: string
}

interface QueueState {
  version: 1
  updatedAt: number
  stats: { queued: number; running: number; succeeded: number; failed: number; dead: number; totalProcessed: number }
  pending: JobRecord[]
  running: JobRecord[]
  completed: JobRecord[]
  deadLetter: JobRecord[]
}

function emptyState(): QueueState {
  return {
    version: 1, updatedAt: Date.now(),
    stats: { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0, totalProcessed: 0 },
    pending: [], running: [], completed: [], deadLetter: [],
  }
}

function load(): QueueState {
  try {
    const raw = fs.readFileSync(QUEUE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as QueueState
    return parsed?.version === 1 ? parsed : emptyState()
  } catch (e: any) {
    if (e.code === 'ENOENT') return emptyState()
    throw e
  }
}

function save(state: QueueState): void {
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true })
  const tmp = QUEUE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), 'utf-8')
  fs.renameSync(tmp, QUEUE_PATH)
}

/** GET — stato queue con filtro opzionale: ?filter=pending|running|completed|dead */
export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get('filter')
  const state = load()

  if (filter === 'pending') return NextResponse.json({ jobs: state.pending, total: state.pending.length })
  if (filter === 'running') return NextResponse.json({ jobs: state.running, total: state.running.length })
  if (filter === 'completed') return NextResponse.json({ jobs: state.completed, total: state.completed.length })
  if (filter === 'dead') return NextResponse.json({ jobs: state.deadLetter, total: state.deadLetter.length })

  return NextResponse.json({
    stats: state.stats,
    pending: state.pending.slice(0, 50),
    running: state.running.slice(0, 50),
    completed: state.completed.slice(-50).reverse(),
    deadLetter: state.deadLetter.slice(-50).reverse(),
  })
}

/** POST — azioni sulla queue: { action: "retry", jobId } o { action: "clear-dlq" } */
export async function POST(req: NextRequest) {
  let body: { action?: string; jobId?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const state = load()

  if (body.action === 'retry' && body.jobId) {
    const idx = state.deadLetter.findIndex(j => j.id === body.jobId)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'job non trovato in dead-letter' }, { status: 404 })
    const [job] = state.deadLetter.splice(idx, 1)
    job.status = 'queued'
    job.attempts = 0
    job.lastError = undefined
    job.endedAt = undefined
    state.pending.push(job)
    state.stats.dead = state.deadLetter.length
    state.stats.queued = state.pending.length
    save(state)
    return NextResponse.json({ ok: true, job })
  }

  if (body.action === 'clear-dlq') {
    const cleared = state.deadLetter.length
    state.deadLetter = []
    state.stats.dead = 0
    save(state)
    return NextResponse.json({ ok: true, cleared })
  }

  return NextResponse.json({ ok: false, error: 'action non valida' }, { status: 400 })
}
