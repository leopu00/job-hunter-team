import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')

type ImportTarget = 'sessions' | 'tasks' | 'config'

const PATHS: Record<ImportTarget, string> = {
  sessions: path.join(JHT_DIR, 'sessions', 'sessions.json'),
  tasks:    path.join(JHT_DIR, 'tasks', 'tasks.json'),
  config:   path.join(JHT_DIR, 'jht.config.json'),
}

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

const VALIDATORS: Record<ImportTarget, (d: unknown) => ValidationResult> = {
  sessions: validateSessions, tasks: validateTasks, config: validateConfig,
}

/** POST /api/import — importa dati JSON. Body: { target, data, mode: 'merge' | 'replace', dryRun? } */
export async function POST(req: NextRequest) {
  let body: { target?: string; data?: unknown; mode?: string; dryRun?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON body non valido' }, { status: 400 }) }

  const target = body.target as ImportTarget
  if (!target || !PATHS[target]) {
    return NextResponse.json({ ok: false, error: 'target obbligatorio: sessions | tasks | config' }, { status: 400 })
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

  const incoming = body.data as Record<string, unknown>
  const items = (incoming.sessions ?? incoming.tasks ?? incoming.data) as unknown[]

  if (mode === 'replace') {
    writeJsonSafe(filePath, target === 'sessions' ? { sessions: items } : { version: 1, updatedAt: Date.now(), tasks: items })
    return NextResponse.json({ ok: true, count: items.length, mode })
  }

  // Merge: aggiungi solo record con ID nuovo
  const existing = readJsonSafe<Record<string, unknown>>(filePath) ?? {}
  const key = target === 'sessions' ? 'sessions' : 'tasks'
  const idField = target === 'sessions' ? 'id' : 'taskId'
  const current = (existing as any)[key] ?? []
  const ids = new Set(current.map((r: any) => r[idField]))
  const added = items.filter((r: any) => !ids.has(r[idField]))
  ;(existing as any)[key] = [...current, ...added]
  ;(existing as any).updatedAt = Date.now()
  writeJsonSafe(filePath, existing)
  return NextResponse.json({ ok: true, count: added.length, skipped: items.length - added.length, mode })
}
