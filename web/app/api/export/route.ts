import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')

type DataSource = 'sessions' | 'tasks' | 'analytics' | 'jobs' | 'applications' | 'contacts' | 'companies' | 'interviews'
type ExportFormat = 'json' | 'csv'

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

const DATE_FIELDS = ['createdAt', 'createdAtMs', 'appliedAt', 'date', 'timestamp', 'closedAt', 'lastContact'];

function filterByDate(items: Record<string, unknown>[], since: number, until: number): Record<string, unknown>[] {
  return items.filter(item => {
    for (const f of DATE_FIELDS) {
      const val = item[f];
      if (typeof val === 'number' && val >= since && val <= until) return true;
    }
    return since === 0 && until >= Date.now();
  });
}

function loadWrapped(file: string, key?: string): (since: number, until: number) => Record<string, unknown>[] {
  return (since, until) => {
    const raw = readJsonSafe<Record<string, unknown>>(path.join(JHT_DIR, file));
    const items = key ? (raw as any)?.[key] ?? [] : Array.isArray(raw) ? raw : [];
    return filterByDate(items, since, until);
  };
}

const LOADERS: Record<DataSource, (since: number, until: number) => Record<string, unknown>[]> = {
  sessions: loadWrapped('sessions/sessions.json', 'sessions'),
  tasks: loadWrapped('tasks/tasks.json', 'tasks'),
  analytics: loadWrapped('analytics/analytics.json', 'entries'),
  jobs: loadWrapped('jobs.json'),
  applications: loadWrapped('applications.json'),
  contacts: loadWrapped('contacts.json'),
  companies: loadWrapped('companies.json'),
  interviews: loadWrapped('interviews.json'),
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
    return NextResponse.json({ ok: false, error: `source obbligatorio: ${Object.keys(LOADERS).join(' | ')}` }, { status: 400 })
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
