import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')

type ImportTarget = 'sessions' | 'tasks' | 'config' | 'jobs' | 'contacts' | 'companies'

const PATHS: Record<ImportTarget, string> = {
  sessions:  path.join(JHT_DIR, 'sessions', 'sessions.json'),
  tasks:     path.join(JHT_DIR, 'tasks', 'tasks.json'),
  config:    path.join(JHT_DIR, 'jht.config.json'),
  jobs:      path.join(JHT_DIR, 'jobs.json'),
  contacts:  path.join(JHT_DIR, 'contacts.json'),
  companies: path.join(JHT_DIR, 'companies.json'),
}

const JH_REQUIRED: Record<string, string[]> = { jobs: ['title', 'company'], contacts: ['name'], companies: ['name'] }

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function writeJsonSafe(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
}

type ValidationResult = { ok: boolean; errors: string[]; count: number }

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object' && !Array.isArray(item))
    : []
}

function validateSessions(data: unknown): ValidationResult {
  const errors: string[] = []
  if (!data || typeof data !== 'object') { errors.push('JSON non valido'); return { ok: false, errors, count: 0 } }
  const obj = data as Record<string, unknown>
  const sessions = obj.sessions ?? obj.data
  if (!Array.isArray(sessions)) { errors.push('Campo "sessions" o "data" mancante o non array'); return { ok: false, errors, count: 0 } }
  for (let i = 0; i < Math.min(sessions.length, 5); i++) {
    const s = sessions[i]
    if (!s.id) errors.push(`Sessione [${i}]: campo "id" mancante`)
  }
  return { ok: errors.length === 0, errors, count: sessions.length }
}

function validateTasks(data: unknown): ValidationResult {
  const errors: string[] = []
  if (!data || typeof data !== 'object') { errors.push('JSON non valido'); return { ok: false, errors, count: 0 } }
  const obj = data as Record<string, unknown>
  const tasks = obj.tasks ?? obj.data
  if (!Array.isArray(tasks)) { errors.push('Campo "tasks" o "data" mancante o non array'); return { ok: false, errors, count: 0 } }
  for (let i = 0; i < Math.min(tasks.length, 5); i++) {
    const t = tasks[i]
    if (!t.taskId) errors.push(`Task [${i}]: campo "taskId" mancante`)
    if (!t.status) errors.push(`Task [${i}]: campo "status" mancante`)
  }
  return { ok: errors.length === 0, errors, count: tasks.length }
}

function validateConfig(data: unknown): ValidationResult {
  const errors: string[] = []
  if (!data || typeof data !== 'object') { errors.push('JSON non valido'); return { ok: false, errors, count: 0 } }
  return { ok: true, errors, count: 1 }
}

function validateJhEntity(data: unknown, entity: string): ValidationResult {
  const errors: string[] = []
  const items = Array.isArray(data) ? data : asRecord(data).data
  if (!Array.isArray(items)) { errors.push('Dati devono essere un array o { data: [...] }'); return { ok: false, errors, count: 0 } }
  const req = JH_REQUIRED[entity] ?? []
  for (let i = 0; i < Math.min(items.length, 10); i++) {
    const missing = req.filter(f => !items[i][f])
    if (missing.length) errors.push(`Riga [${i}]: mancano ${missing.join(', ')}`)
  }
  return { ok: errors.length === 0, errors, count: items.length }
}

const VALIDATORS: Record<ImportTarget, (d: unknown) => ValidationResult> = {
  sessions: validateSessions, tasks: validateTasks, config: validateConfig,
  jobs: d => validateJhEntity(d, 'jobs'), contacts: d => validateJhEntity(d, 'contacts'), companies: d => validateJhEntity(d, 'companies'),
}

/** POST /api/import — importa dati JSON. Body: { target, data, mode: 'merge' | 'replace', dryRun? } */
export async function POST(req: NextRequest) {
  let body: { target?: string; data?: unknown; mode?: string; dryRun?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON body non valido' }, { status: 400 }) }

  const target = body.target as ImportTarget
  if (!target || !PATHS[target]) {
    return NextResponse.json({ ok: false, error: `target obbligatorio: ${Object.keys(PATHS).join(' | ')}` }, { status: 400 })
  }
  if (!body.data) return NextResponse.json({ ok: false, error: 'campo "data" obbligatorio' }, { status: 400 })

  const validation = VALIDATORS[target](body.data)
  if (!validation.ok) return NextResponse.json({ ok: false, errors: validation.errors, count: 0 }, { status: 422 })
  if (body.dryRun) return NextResponse.json({ ok: true, dryRun: true, count: validation.count, errors: [] })

  const mode = body.mode === 'replace' ? 'replace' : 'merge'
  const filePath = PATHS[target]

  if (target === 'config') {
    writeJsonSafe(filePath, body.data)
    return NextResponse.json({ ok: true, count: 1, mode })
  }

  const isJh = ['jobs', 'contacts', 'companies'].includes(target)
  const incoming = asRecord(body.data)
  const items = isJh
    ? recordArray(Array.isArray(body.data) ? body.data : incoming.data)
    : recordArray(incoming.sessions ?? incoming.tasks ?? incoming.data)

  if (mode === 'replace') {
    if (isJh) { writeJsonSafe(filePath, items) }
    else { writeJsonSafe(filePath, target === 'sessions' ? { sessions: items } : { version: 1, updatedAt: Date.now(), tasks: items }) }
    return NextResponse.json({ ok: true, count: items.length, mode })
  }

  // Merge: aggiungi solo record con ID nuovo
  if (isJh) {
    const current = readJsonSafe<Record<string, unknown>[]>(filePath) ?? []
    const existing = Array.isArray(current) ? current : []
    const ids = new Set(existing.map((r) => r.id))
    const added = items.filter((r) => !ids.has(r.id))
    writeJsonSafe(filePath, [...existing, ...added])
    return NextResponse.json({ ok: true, count: added.length, skipped: items.length - added.length, mode })
  }

  const existing = readJsonSafe<Record<string, unknown>>(filePath) ?? {}
  const key = target === 'sessions' ? 'sessions' : 'tasks'
  const idField = target === 'sessions' ? 'id' : 'taskId'
  const current = recordArray(existing[key])
  const ids = new Set(current.map((r) => r[idField]))
  const added = items.filter((r) => !ids.has(r[idField]))
  existing[key] = [...current, ...added]
  existing.updatedAt = Date.now()
  writeJsonSafe(filePath, existing)
  return NextResponse.json({ ok: true, count: added.length, skipped: items.length - added.length, mode })
}
