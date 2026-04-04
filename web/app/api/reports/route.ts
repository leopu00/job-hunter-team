import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const JHT       = path.join(os.homedir(), '.jht')
const TASKS_DIR = path.join(os.homedir(), '.jht-dev', 'tasks')

type Row = { module: string; metric: string; value: string; detail: string }

const MODULES = [
  { id: 'tasks',          label: 'Task' },
  { id: 'api_usage',      label: 'API Usage' },
  { id: 'forum_activity', label: 'Attività Forum' },
  { id: 'deploys',        label: 'Deploy / Merge' },
]

export async function GET() {
  return NextResponse.json({ modules: MODULES })
}

function inRange(ts: string, from: string, to: string) {
  const d = ts.slice(0, 10)
  return d >= from && d <= to
}

function taskRows(from: string, to: string): Row[] {
  if (!fs.existsSync(TASKS_DIR)) return []
  const counts: Record<string, number> = {}
  for (const f of fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md') && f !== '_template.md')) {
    const lines = fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8').split('\n')
    const updated = lines.find(l => l.startsWith('aggiornato:'))?.replace('aggiornato:', '').trim() ?? ''
    if (!inRange(updated, from, to)) continue
    const stato = lines.find(l => l.startsWith('stato:'))?.replace('stato:', '').trim() ?? 'unknown'
    counts[stato] = (counts[stato] ?? 0) + 1
  }
  return Object.entries(counts).map(([stato, n]) => ({ module: 'tasks', metric: `Stato: ${stato}`, value: String(n), detail: '' }))
}

function apiUsageRows(from: string, to: string): Row[] {
  const p = path.join(JHT, 'sentinel-data.jsonl')
  if (!fs.existsSync(p)) return []
  const points = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean).filter(d => inRange(d.ts, from, to))
  if (!points.length) return [{ module: 'api_usage', metric: 'Nessun dato', value: '—', detail: from + ' → ' + to }]
  const usages = points.map((d: { usage: number }) => d.usage)
  return [
    { module: 'api_usage', metric: 'Campioni',       value: String(points.length),                         detail: '' },
    { module: 'api_usage', metric: 'Usage medio',    value: `${Math.round(usages.reduce((a: number, b: number) => a + b, 0) / usages.length)}%`, detail: '' },
    { module: 'api_usage', metric: 'Usage massimo',  value: `${Math.max(...usages)}%`,                     detail: '' },
    { module: 'api_usage', metric: 'Usage minimo',   value: `${Math.min(...usages)}%`,                     detail: '' },
  ]
}

function forumRows(from: string, to: string): Row[] {
  const p = path.join(JHT, 'forum.log')
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim())
  const counts: Record<string, number> = {}
  for (const line of lines) {
    const m = line.match(/^\[(\d{4}-\d{2}-\d{2}).*\] \[(\w+)\]/)
    if (!m || !inRange(m[1], from, to)) continue
    counts[m[2]] = (counts[m[2]] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([author, n]) => ({ module: 'forum_activity', metric: author, value: String(n) + ' messaggi', detail: '' }))
}

function deployRows(from: string, to: string): Row[] {
  try {
    const out = execSync(`git log --oneline --merges --after="${from}" --before="${to} 23:59:59" 2>/dev/null | wc -l`, { stdio: 'pipe' }).toString().trim()
    return [{ module: 'deploys', metric: 'Merge commit', value: out, detail: `${from} → ${to}` }]
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  const { from, to, modules } = await req.json().catch(() => ({}))
  if (!from || !to || !Array.isArray(modules)) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const rows: Row[] = []
  if (modules.includes('tasks'))          rows.push(...taskRows(from, to))
  if (modules.includes('api_usage'))      rows.push(...apiUsageRows(from, to))
  if (modules.includes('forum_activity')) rows.push(...forumRows(from, to))
  if (modules.includes('deploys'))        rows.push(...deployRows(from, to))

  return NextResponse.json({ report: { period: { from, to }, generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '), modules, rows } })
}
