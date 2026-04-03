import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CRON_DIR   = path.join(os.homedir(), '.jht', 'cron')
const CRON_STORE = path.join(CRON_DIR, 'jobs.json')

interface StoreFile { version: 1; jobs: Array<Record<string, unknown>> }

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

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const store = readStore()
  const job = store.jobs.find(j => j.id === id)
  if (!job) return NextResponse.json({ error: 'job non trovato' }, { status: 404 })

  if (typeof body.enabled === 'boolean') job.enabled = body.enabled
  if (typeof body.name === 'string' && body.name.trim()) job.name = body.name.trim()
  if (typeof body.description === 'string') job.description = body.description.trim()
  job.updatedAtMs = Date.now()

  writeStore(store)
  return NextResponse.json({ ok: true, job })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const store = readStore()
  const idx = store.jobs.findIndex(j => j.id === id)
  if (idx === -1) return NextResponse.json({ error: 'job non trovato' }, { status: 404 })

  store.jobs.splice(idx, 1)
  writeStore(store)
  return NextResponse.json({ ok: true })
}
