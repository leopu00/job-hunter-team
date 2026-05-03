import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

// Stato del pacing-bridge (`.launcher/pacing-bridge.py`).
// Pattern identico a /api/bridge/status: il processo Python scrive
// atomicamente $JHT_HOME/logs/pacing-bridge-state.json a ogni tick e al
// boot. La UI legge da qui sia il countdown (next_tick_at) sia il
// payload completo dell'ultimo report (last_report) per il popover di
// dettaglio cliccabile.
//
// Niente fallback: se il file non c'è, lo stato è "non avviato" e la
// UI mostra il nodo come pending. Non vogliamo replicare la logica del
// bridge in TS — il file di stato è la sola source of truth.

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
const PID_FILE = path.join(JHT_HOME, 'logs', 'pacing-bridge.pid')
const STATE_FILE = path.join(JHT_HOME, 'logs', 'pacing-bridge-state.json')

// Lo stato è scritto a ogni tick (default 15 min) + al boot. 30 min di
// staleness lasciano comodo margine per un tick mancato senza far
// passare il bridge per "down".
const STATE_STALE_MS = 30 * 60_000

type PacingAgent = {
  name: string
  kt: number
  kt_per_h: number
  pct_per_h: number
  share: number
}

type PacingVerdict = {
  kind: 'SFORO' | 'MARGINE' | 'ALLINEATO' | 'ND'
  delta: number | null
  frac_pct: number | null
}

type PacingReport = {
  ok: boolean
  ts: string
  window_min: number
  effective_window_min: number
  n_samples: number
  usage_now: number | null
  proj: number | null
  reset_at: string | null
  h_to_reset: number | null
  delta_usage: number
  team_kt: number
  ratio_kt_per_pct: number
  vel_team: number
  vel_target: number | null
  target_band_center: number
  agents: PacingAgent[]
  skipped: string[]
  verdict: PacingVerdict
  // Campi presenti solo quando ok=false:
  error?: string
  hint?: string
}

type PacingState = {
  version?: number
  pid?: number
  updated_at?: string
  next_tick_at?: string
  tick_interval_min?: number
  target_band_center?: number
  target_session?: string
  last_tick_at?: string | null
  last_report?: PacingReport | null
  last_message?: string | null
}

async function isRunning(): Promise<{ running: boolean; pid: number | null }> {
  let pidStr: string
  try {
    pidStr = await fs.readFile(PID_FILE, 'utf-8')
  } catch {
    return { running: false, pid: null }
  }
  const pid = Number.parseInt(pidStr.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return { running: false, pid: null }

  // Stesso check dell'altro bridge: filtriamo pid riciclati guardando
  // il cmdline (disponibile in /proc su Linux container).
  try {
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8')
    if (cmdline.includes('pacing-bridge.py')) return { running: true, pid }
    return { running: false, pid: null }
  } catch {
    // /proc non leggibile (host macOS): se il pidfile parsa, fidiamoci.
    return { running: process.platform !== 'linux', pid }
  }
}

async function readState(): Promise<PacingState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as PacingState
  } catch {
    return null
  }
}

export async function GET() {
  const [status, state] = await Promise.all([isRunning(), readState()])

  if (!state) {
    return NextResponse.json({
      ...status,
      lastTickAt: null,
      nextTickAt: null,
      tickIntervalMin: null,
      targetBandCenter: null,
      lastReport: null,
      lastMessage: null,
      source: 'no-state-file',
    })
  }

  const updatedAt = state.updated_at ? Date.parse(state.updated_at) : NaN
  const fresh =
    Number.isFinite(updatedAt) && Date.now() - updatedAt < STATE_STALE_MS

  return NextResponse.json({
    ...status,
    lastTickAt: state.last_tick_at ?? null,
    nextTickAt: state.next_tick_at ?? null,
    tickIntervalMin: state.tick_interval_min ?? null,
    targetBandCenter: state.target_band_center ?? null,
    targetSession: state.target_session ?? null,
    lastReport: state.last_report ?? null,
    lastMessage: state.last_message ?? null,
    updatedAt: state.updated_at ?? null,
    stale: !fresh,
    source: 'state-file',
  })
}
