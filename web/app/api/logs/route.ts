import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const LOG_DIR = path.join(os.homedir(), '.jht', 'logs')
const LOG_PREFIX = 'jht-'
const LOG_SUFFIX = '.log'
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2000

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
interface LogEntry { time: string; level: LogLevel; subsystem: string; message: string; data?: Record<string, unknown> }

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function logFilePath(date: string): string {
  return path.join(LOG_DIR, `${LOG_PREFIX}${date}${LOG_SUFFIX}`)
}

function readLogFile(filePath: string): LogEntry[] {
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, 'utf-8')
  const entries: LogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.level && parsed.message) entries.push(parsed as LogEntry)
    } catch { /* skip malformed */ }
  }
  return entries
}

function listLogDates(): string[] {
  if (!fs.existsSync(LOG_DIR)) return []
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith(LOG_PREFIX) && f.endsWith(LOG_SUFFIX))
    .map(f => f.slice(LOG_PREFIX.length, -LOG_SUFFIX.length))
    .sort()
    .reverse()
}

function extractSubsystems(entries: LogEntry[]): string[] {
  const set = new Set<string>()
  for (const e of entries) if (e.subsystem) set.add(e.subsystem)
  return [...set].sort()
}

const SAMPLE_SUBSYSTEMS = ['gateway', 'coordinator', 'scout', 'assistente', 'scrittore', 'tui', 'web', 'config']
const SAMPLE_MESSAGES: Record<LogLevel, string[]> = {
  debug: ['Cache hit per sessione abc-123', 'Parsing config completato in 12ms', 'WebSocket heartbeat OK', 'Token refresh non necessario'],
  info:  ['Server avviato su porta 3002', 'Job match trovato: Frontend Dev @ Acme', 'Sessione utente creata', 'Config ricaricata da disco', 'Worker scout attivato'],
  warn:  ['Rate limit vicino (80%)', 'Risposta API lenta (2.3s)', 'Config mancante per telegram', 'Retry tentativo 2/3 per API call'],
  error: ['Connessione DB fallita: timeout', 'API key non valida — 401', 'Worker crash: out of memory', 'File non trovato: jobs.json'],
}

function generateSampleLogs(date: string): LogEntry[] {
  const entries: LogEntry[] = []
  const levels: LogLevel[] = ['debug', 'info', 'info', 'info', 'warn', 'error']
  for (let i = 0; i < 60; i++) {
    const h = String(Math.floor(i * 24 / 60)).padStart(2, '0')
    const m = String((i * 17) % 60).padStart(2, '0')
    const s = String((i * 31) % 60).padStart(2, '0')
    const level = levels[i % levels.length]
    const msgs = SAMPLE_MESSAGES[level]
    entries.push({
      time: `${date}T${h}:${m}:${s}.${String((i * 137) % 1000).padStart(3, '0')}Z`,
      level,
      subsystem: SAMPLE_SUBSYSTEMS[i % SAMPLE_SUBSYSTEMS.length],
      message: msgs[i % msgs.length],
    })
  }
  return entries
}

/** GET — log strutturati con filtri: ?date=YYYY-MM-DD&level=error&subsystem=gateway&limit=100&offset=0 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const date = sp.get('date') ?? formatDate(new Date())
  const level = sp.get('level') as LogLevel | null
  const subsystem = sp.get('subsystem')
  const search = sp.get('search')
  const limit = Math.min(Number(sp.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)
  const offset = Number(sp.get('offset')) || 0

  const filePath = logFilePath(date)
  let entries = readLogFile(filePath)
  // no sample fallback — empty until real logs exist

  if (level) entries = entries.filter(e => e.level === level)
  if (subsystem) entries = entries.filter(e => e.subsystem === subsystem)
  if (search) {
    const q = search.toLowerCase()
    entries = entries.filter(e => e.message.toLowerCase().includes(q) || e.subsystem.toLowerCase().includes(q))
  }

  const total = entries.length
  const subsystems = extractSubsystems(readLogFile(filePath))
  const dates = listLogDates()

  // Ultimi log prima (ordine inverso), poi paginazione
  entries.reverse()
  const paginated = entries.slice(offset, offset + limit)

  return NextResponse.json({
    entries: paginated,
    total,
    date,
    dates,
    subsystems,
    hasMore: offset + limit < total,
  })
}
