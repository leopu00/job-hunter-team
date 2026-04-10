import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const JHT = JHT_HOME
const FORUM_PATH    = path.join(JHT, 'forum.log')
const SENTINEL_PATH = path.join(JHT, 'sentinel-log.txt')

type Severity = 'info' | 'warning' | 'critical'
type AuditEvent = { id: string; ts: string; severity: Severity; actor: string; action: string; detail: string }

const FORUM_RE    = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (.+)$/
const SENTINEL_RE = /^\[(\S+)\] (Ordine .+|===.+===)$/

function isoToLocal(ts: string) { return ts.replace('T', ' ').slice(0, 19) }

function fromForum(): AuditEvent[] {
  if (!fs.existsSync(FORUM_PATH)) return []
  const lines = fs.readFileSync(FORUM_PATH, 'utf-8').split('\n').filter(l => l.trim())
  const events: AuditEvent[] = []
  for (const line of lines) {
    const m = line.match(FORUM_RE)
    if (!m) continue
    const [, ts, actor, text] = m
    const lo = text.toLowerCase()
    let action = '', severity: Severity = 'info'
    const detail = text
    if (lo.includes('[merged]') || lo.includes('mergiato'))     { action = 'PR Merged';   severity = 'info' }
    else if (lo.includes('[rejected]'))                          { action = 'PR Rejected'; severity = 'warning' }
    else if (lo.includes('[pr]'))                                { action = 'PR Aperta';   severity = 'info' }
    else if (lo.includes('pausa generale'))                      { action = 'Pausa team';  severity = 'warning' }
    else if (lo.includes('riattivazione'))                       { action = 'Riattivazione'; severity = 'info' }
    else if (lo.includes('reset') && lo.includes('sessione'))   { action = 'Reset sessione'; severity = 'critical' }
    else continue
    events.push({ id: `f-${ts}-${events.length}`, ts, severity, actor, action, detail: detail.slice(0, 120) })
  }
  return events
}

function fromSentinel(): AuditEvent[] {
  if (!fs.existsSync(SENTINEL_PATH)) return []
  const lines = fs.readFileSync(SENTINEL_PATH, 'utf-8').split('\n').filter(l => l.trim())
  const events: AuditEvent[] = []
  for (const line of lines) {
    const m = line.match(SENTINEL_RE)
    if (!m) continue
    const [, rawTs, text] = m
    const ts = isoToLocal(rawTs)
    const lo = text.toLowerCase()
    let action = '', severity: Severity = 'info'
    if (lo.includes('reset sessione'))       { action = 'Reset sessione'; severity = 'critical' }
    else if (lo.includes('rallentare'))      { action = `Throttle ${text.match(/throttle=(\d+)/)?.[1] ?? '?'}`; severity = lo.includes('throttle=4') ? 'critical' : 'warning' }
    else if (lo.includes('accelerare'))      { action = 'Accelerare'; severity = 'info' }
    else continue
    events.push({ id: `s-${ts}-${events.length}`, ts, severity, actor: 'Vigil', action, detail: text.slice(0, 120) })
  }
  return events
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const severity = searchParams.get('severity') ?? ''
  const date     = searchParams.get('date')     ?? ''

  let events = [...fromForum(), ...fromSentinel()]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 500)

  if (severity) events = events.filter(e => e.severity === severity)
  if (date)     events = events.filter(e => e.ts.startsWith(date))

  return NextResponse.json({ events: events.slice(0, 200), total: events.length })
}
