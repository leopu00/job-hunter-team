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
// Bridge V5 ha tick fisso a 5 min (TICK_INTERVAL_MIN). Lo cabliamo qui
// per derivare nextTickAt finché il bridge non lo esporrà esplicitamente.
const BRIDGE_INTERVAL_MS = 5 * 60_000

/** Cerca l'ultimo sample con source=bridge nel JSONL e ritorna il suo ts.
 *  Più affidabile che dedurre dal /tmp/sentinel-bridge.log (formato testo). */
async function readLastBridgeSample(): Promise<{ ts: string } | null> {
  let raw: string
  try { raw = await fs.readFile(DATA_JSONL, 'utf-8') }
  catch { return null }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const e = JSON.parse(line) as { source?: string; ts?: string }
      if (e.source === 'bridge' && typeof e.ts === 'string') return { ts: e.ts }
    } catch { /* skip */ }
  }
  return null
}

export async function GET() {
  const [status, lastSample] = await Promise.all([isBridgeRunning(), readLastBridgeSample()])
  const lastTickAt = lastSample?.ts ?? null
  const nextTickAt = lastTickAt && status.running
    ? new Date(new Date(lastTickAt).getTime() + BRIDGE_INTERVAL_MS).toISOString()
    : null
  return NextResponse.json({
    ...status,
    lastTickAt,
    nextTickAt,
    intervalMs: BRIDGE_INTERVAL_MS,
  })
}

