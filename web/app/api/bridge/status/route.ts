import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

// Stato del bridge sentinel (process Python sentinel-bridge.py).
// Lo consideriamo "running" se:
//   1. il pid file $JHT_HOME/logs/sentinel-bridge.pid esiste
//   2. il pid puntato è ancora vivo
//   3. cmdline del pid contiene 'sentinel-bridge.py' (per evitare falsi
//      positivi su pid riciclati dopo restart container — stesso check
//      che il bridge usa nel suo singleton lock)

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
const PID_FILE = path.join(JHT_HOME, 'logs', 'sentinel-bridge.pid')

async function isBridgeRunning(): Promise<{ running: boolean; pid: number | null }> {
  let pidStr: string
  try {
    pidStr = await fs.readFile(PID_FILE, 'utf-8')
  } catch {
    return { running: false, pid: null }
  }
  const pid = Number.parseInt(pidStr.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return { running: false, pid: null }

  // Controllo cmdline per filtrare pid riciclati (init/dbus/ecc).
  try {
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8')
    if (cmdline.includes('sentinel-bridge.py')) return { running: true, pid }
    return { running: false, pid: null }
  } catch {
    // /proc/<pid>/cmdline non leggibile su macOS host, ma il pidfile vive
    // dentro $JHT_HOME montato dal container Linux dove /proc esiste. Se
    // siamo su un host non-linux il check del cmdline va in errore: in
    // quel caso assumiamo "running" se il pidfile esiste e parsa.
    return { running: process.platform !== 'linux', pid }
  }
}

const DATA_JSONL = path.join(JHT_HOME, 'logs', 'sentinel-data.jsonl')

// Replica della logica _choose_tick_interval del bridge (sentinel-bridge.py:91).
// Il bridge V5 NON ha un tick fisso: adatta in base allo stato dell'ultimo
// sample. Mantenere queste costanti allineate al bridge Python.
const ADAPTIVE_TICK_FAST_MIN = 1.5      // SOTTOUTILIZZO / ATTENZIONE / CRITICO
const ADAPTIVE_TICK_SLOW_MIN = 5.0      // STEADY / RESET / OK / null
const ADAPTIVE_TICK_EMERGENCY_MIN = 1.0 // EMERGENZA o freeze (proj > 100%)

function chooseTickIntervalMin(status: string | null, projection: number | null): number {
  const freezeActive = typeof projection === 'number' && projection > 100
  if (freezeActive || status === 'EMERGENZA') return ADAPTIVE_TICK_EMERGENCY_MIN
  if (status && ['SOTTOUTILIZZO', 'ATTENZIONE', 'CRITICO'].includes(status)) {
    return ADAPTIVE_TICK_FAST_MIN
  }
  return ADAPTIVE_TICK_SLOW_MIN
}

type BridgeSample = { ts: string; status: string | null; projection: number | null }

/** Cerca l'ultimo sample con source=bridge nel JSONL: ne servono ts +
 *  status + projection per replicare la logica adattiva del tick. */
async function readLastBridgeSample(): Promise<BridgeSample | null> {
  let raw: string
  try { raw = await fs.readFile(DATA_JSONL, 'utf-8') }
  catch { return null }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const e = JSON.parse(line) as { source?: string; ts?: string; status?: string; projection?: number }
      if (e.source === 'bridge' && typeof e.ts === 'string') {
        return {
          ts: e.ts,
          status: e.status ?? null,
          projection: typeof e.projection === 'number' ? e.projection : null,
        }
      }
    } catch { /* skip */ }
  }
  return null
}

export async function GET() {
  const [status, lastSample] = await Promise.all([isBridgeRunning(), readLastBridgeSample()])
  const lastTickAt = lastSample?.ts ?? null
  // Tick interval calcolato dallo stato dell'ultimo sample, esattamente
  // come fa il bridge prima di chiamare time.sleep(). Se lastSample è null
  // (cold-start) cadiamo sullo SLOW = 5 min.
  const intervalMin = chooseTickIntervalMin(
    lastSample?.status ?? null,
    lastSample?.projection ?? null,
  )
  const intervalMs = Math.round(intervalMin * 60_000)
  const nextTickAt = lastTickAt && status.running
    ? new Date(new Date(lastTickAt).getTime() + intervalMs).toISOString()
    : null
  return NextResponse.json({
    ...status,
    lastTickAt,
    lastStatus: lastSample?.status ?? null,
    lastProjection: lastSample?.projection ?? null,
    nextTickAt,
    intervalMs,
    intervalMin,
  })
}


