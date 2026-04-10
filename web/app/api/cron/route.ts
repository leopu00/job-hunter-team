import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const CRON_DIR   = path.join(JHT_HOME, 'cron')
const CRON_STORE = path.join(CRON_DIR, 'jobs.json')

interface CronJob {
  id: string; name: string; description?: string; enabled: boolean
  deleteAfterRun?: boolean; createdAtMs: number; updatedAtMs: number
  schedule: Record<string, unknown>; payload: Record<string, unknown>
  state: { nextRunAtMs?: number; lastRunAtMs?: number; lastRunStatus?: string; lastError?: string; lastDurationMs?: number }
}
interface StoreFile { version: 1; jobs: CronJob[] }

function readStore(): StoreFile {
  try {
    if (!fs.existsSync(CRON_STORE)) return { version: 1, jobs: [] }
    return JSON.parse(fs.readFileSync(CRON_STORE, 'utf-8')) as StoreFile
  } catch { return { version: 1, jobs: [] } }
}

function writeStore(store: StoreFile) {
  fs.mkdirSync(CRON_DIR, { recursive: true })
  const tmp = `${CRON_STORE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  try { fs.renameSync(tmp, CRON_STORE) } catch {
    fs.copyFileSync(tmp, CRON_STORE); fs.unlinkSync(tmp)
  }
}

export async function GET() {
  const store = readStore()
  return NextResponse.json({ jobs: store.jobs })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name obbligatorio' }, { status: 400 })

  const schedule = body.schedule as Record<string, unknown> | undefined
  if (!schedule || typeof schedule !== 'object') return NextResponse.json({ error: 'schedule obbligatorio' }, { status: 400 })

  const payload = body.payload as Record<string, unknown> | undefined
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'payload obbligatorio' }, { status: 400 })

  // Prevenzione injection nel command
  const command = typeof payload.command === 'string' ? payload.command : ''
  if (/[\n\r\0]/.test(command)) return NextResponse.json({ error: 'command contiene caratteri non validi' }, { status: 400 })

  const now = Date.now()
  const job: CronJob = {
    id: randomUUID(), name,
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    enabled: body.enabled !== false,
    deleteAfterRun: body.deleteAfterRun === true,
    createdAtMs: now, updatedAtMs: now,
    schedule, payload,
    state: {},
  }

  const store = readStore()
  store.jobs.push(job)
  writeStore(store)
  return NextResponse.json({ ok: true, job })
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id obbligatorio' }, { status: 400 })

  const store = readStore()
  const job = store.jobs.find((j) => j.id === id)
  if (!job) return NextResponse.json({ error: 'job non trovato' }, { status: 404 })

  // Campi aggiornabili: enabled, name, description, schedule, payload
  if (typeof body.enabled === 'boolean') job.enabled = body.enabled
  if (typeof body.name === 'string') job.name = body.name.trim()
  if (typeof body.description === 'string') job.description = body.description.trim()
  if (body.schedule && typeof body.schedule === 'object') job.schedule = body.schedule as Record<string, unknown>
  if (body.payload && typeof body.payload === 'object') {
    const command = typeof (body.payload as Record<string, unknown>).command === 'string'
      ? (body.payload as Record<string, unknown>).command as string : ''
    if (/[\n\r\0]/.test(command)) return NextResponse.json({ error: 'command contiene caratteri non validi' }, { status: 400 })
    job.payload = body.payload as Record<string, unknown>
  }
  job.updatedAtMs = Date.now()

  writeStore(store)
  return NextResponse.json({ ok: true, job })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'id obbligatorio (query param)' }, { status: 400 })

  const store = readStore()
  const idx = store.jobs.findIndex((j) => j.id === id)
  if (idx === -1) return NextResponse.json({ error: 'job non trovato' }, { status: 404 })

  const removed = store.jobs.splice(idx, 1)[0]
  writeStore(store)
  return NextResponse.json({ ok: true, removed })
}
