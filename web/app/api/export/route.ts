import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')

type DataSource = 'sessions' | 'tasks' | 'analytics'
type ExportFormat = 'json' | 'csv'

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function loadSessions(since: number, until: number): Record<string, unknown>[] {
  const store = readJsonSafe<{ sessions?: Record<string, unknown>[] }>(path.join(JHT_DIR, 'sessions', 'sessions.json'))
  return (store?.sessions ?? []).filter((s: any) => {
    const ts = s.createdAtMs ?? s.createdAt ?? 0
    return ts >= since && ts <= until
  })
}

function loadTasks(since: number, until: number): Record<string, unknown>[] {
  const store = readJsonSafe<{ tasks?: Record<string, unknown>[] }>(path.join(JHT_DIR, 'tasks', 'tasks.json'))
  return (store?.tasks ?? []).filter((t: any) => {
    const ts = t.createdAt ?? 0
    return ts >= since && ts <= until
  })
}

function loadAnalytics(since: number, until: number): Record<string, unknown>[] {
  const store = readJsonSafe<{ entries?: Record<string, unknown>[] }>(path.join(JHT_DIR, 'analytics', 'analytics.json'))
  return (store?.entries ?? []).filter((e: any) => {
    const ts = e.timestamp ?? 0
    return ts >= since && ts <= until
  })
}

const LOADERS: Record<DataSource, (since: number, until: number) => Record<string, unknown>[]> = {
  sessions: loadSessions, tasks: loadTasks, analytics: loadAnalytics,
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const escape = (v: unknown): string => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = keys.map(escape).join(',')
  const lines = rows.map(r => keys.map(k => escape(r[k])).join(','))
  return [header, ...lines].join('\n')
}

/** GET /api/export?source=tasks&format=csv&from=2026-01-01&to=2026-12-31 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const source = sp.get('source') as DataSource | null
  const format = (sp.get('format') ?? 'json') as ExportFormat

  if (!source || !LOADERS[source]) {
    return NextResponse.json({ ok: false, error: 'source obbligatorio: sessions | tasks | analytics' }, { status: 400 })
  }
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ ok: false, error: 'format: json | csv' }, { status: 400 })
  }

  const fromStr = sp.get('from')
  const toStr = sp.get('to')
  const since = fromStr ? new Date(fromStr).getTime() : 0
  const until = toStr ? new Date(toStr + 'T23:59:59').getTime() : Date.now()

  if (isNaN(since) || isNaN(until)) {
    return NextResponse.json({ ok: false, error: 'date non valide (formato YYYY-MM-DD)' }, { status: 400 })
  }

  const rows = LOADERS[source](since, until)
  const filename = `jht-${source}-${new Date().toISOString().slice(0, 10)}.${format}`

  if (format === 'csv') {
    const csv = toCsv(rows)
    return new NextResponse(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  }

  const body = JSON.stringify({ source, count: rows.length, exportedAt: new Date().toISOString(), data: rows }, null, 2)
  return new NextResponse(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}
