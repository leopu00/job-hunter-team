import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

// Stato del token-meter daemon (shared/skills/token-meter.py).
// Pattern identico a /api/bridge/status: legge il file di stato scritto
// atomicamente dal daemon e lo restituisce così com'è, senza ricostruire
// la logica in TS. Una sola fonte di verità (lezione bridge V6 → state file).
//
// Running detection:
//   1. PID file esiste
//   2. PID vivo (cmdline check su /proc/<pid>/cmdline contiene 'token-meter.py')
//   3. Sul mac dev host /proc non c'è: fallback su freshness dello state file.

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
const PID_FILE = path.join(JHT_HOME, 'logs', 'token-meter.pid')
const STATE_FILE = path.join(JHT_HOME, 'logs', 'token-meter-state.json')

// Staleness: il daemon scrive ogni 30s. Oltre 5 min lo trattiamo come down.
const STATE_STALE_MS = 5 * 60_000

async function isMeterRunning(): Promise<{ running: boolean; pid: number | null }> {
  let pidStr: string
  let pidMtimeMs: number | null = null
  try {
    pidStr = await fs.readFile(PID_FILE, 'utf-8')
    try { pidMtimeMs = (await fs.stat(PID_FILE)).mtimeMs } catch { /* ignore */ }
  } catch {
    return { running: false, pid: null }
  }
  const pid = Number.parseInt(pidStr.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return { running: false, pid: null }

  try {
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8')
    if (cmdline.includes('token-meter.py')) return { running: true, pid }
    return { running: false, pid: null }
  } catch {
    // Mac dev host: /proc non disponibile. Usa la freshness dello state file
    // come prova-di-vita (il daemon lo riscrive ogni 30s).
    try {
      const stat = await fs.stat(STATE_FILE)
      if (Date.now() - stat.mtimeMs < STATE_STALE_MS) return { running: true, pid }
    } catch { /* state file mancante */ }
    if (pidMtimeMs !== null && Date.now() - pidMtimeMs < STATE_STALE_MS) {
      return { running: true, pid }
    }
    return { running: false, pid: null }
  }
}

type MeterState = {
  version?: number
  updated_at?: string
  provider?: string
  window_hours?: number
  window_source?: string
  bridge?: {
    usage_pct?: number | null
    projection?: number | null
    status?: string | null
    reset_at?: string | null
    last_tick_at?: string | null
  }
  tokens?: {
    events?: number
    sessions?: number
    input_raw?: number
    output_raw?: number
    cache_read_raw?: number
    cache_creation_raw?: number
    weighted_total?: number
  }
  ratio?: {
    instant_tokens_per_pct?: number | null
    ema_tokens_per_pct?: number | null
    ema_kt_per_pct?: number | null
    alpha?: number
    calibrations?: number
  }
  per_agent?: Record<string, {
    rate_tokens_per_min_60s?: number
    rate_kt_per_min_60s?: number
    weighted_60s?: number
    last_event_at?: string | null
    idle_seconds?: number | null
  }>
  per_agent_rolling_window_s?: number
}

async function readMeterState(): Promise<MeterState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as MeterState
  } catch {
    return null
  }
}

export async function GET() {
  const [status, state] = await Promise.all([isMeterRunning(), readMeterState()])

  if (!state || !state.updated_at) {
    // Fallback: nessuno state file. Probabilmente daemon mai partito.
    return NextResponse.json({
      running: status.running,
      pid: status.pid,
      stale: true,
      source: 'no-state-file',
    })
  }

  const updatedAt = Date.parse(state.updated_at)
  const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY
  const stale = ageMs >= STATE_STALE_MS

  return NextResponse.json({
    running: status.running && !stale,
    pid: status.pid,
    stale,
    ageMs,
    updatedAt: state.updated_at,
    provider: state.provider ?? null,
    windowHours: state.window_hours ?? null,
    windowSource: state.window_source ?? null,
    bridge: state.bridge ?? null,
    tokens: state.tokens ?? null,
    ratio: state.ratio ?? null,
    perAgent: state.per_agent ?? {},
    perAgentRollingWindowS: state.per_agent_rolling_window_s ?? null,
    source: 'state-file',
  })
}
