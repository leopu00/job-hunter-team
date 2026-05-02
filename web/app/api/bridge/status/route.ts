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
//
// Il next_tick_at NON viene calcolato qui: lo legge dal file di stato
// scritto dal bridge stesso (sentinel-bridge-state.json). Questo evita
// che la UI mostri timer sballati ogni volta che cambia la logica del
// bridge (V5 → V6 ecc.). Il file è scritto atomicamente dal bridge a
// ogni iterazione del loop (vedi `_write_state_file` in sentinel-bridge.py).

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
const PID_FILE = path.join(JHT_HOME, 'logs', 'sentinel-bridge.pid')
const STATE_FILE = path.join(JHT_HOME, 'logs', 'sentinel-bridge-state.json')
const DATA_JSONL = path.join(JHT_HOME, 'logs', 'sentinel-data.jsonl')

// Soglia di staleness dello state file: oltre questo lo trattiamo come
// "non disponibile" e cadiamo sul fallback (ultimo sample dal JSONL).
// Il bridge in regime calmo ha tick di 10 min, quindi diamo margine.
const STATE_STALE_MS = 15 * 60_000

// Fallback: se il file di stato non c'è (o è stale) usiamo questo come
// stima del prossimo tick. NON è la replica di chooseTickInterval del
// bridge — è solo un default ragionevole per evitare che la UI mostri
// "tra qualche secondo" o "mai". Il bridge V6 default è 3 min.
const FALLBACK_TICK_MIN = 3.0

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

type BridgeState = {
  version?: number
  pid?: number
  updated_at?: string
  last_tick_at?: string
  next_tick_at?: string
  tick_phase?: string
  tick_interval_min?: number
  gspot_consecutive?: number
  last_sentinella_notify_at?: string | null
  last_status?: string | null
  last_projection?: number | null
  last_usage?: number | null
  g_spot?: { lower: number; upper: number }
  sentinella_cooldown_min?: number
}

/** Legge il file di stato pubblico del bridge. È la fonte autoritativa
 *  del next_tick_at: il bridge stesso lo scrive ad ogni iterazione. */
async function readBridgeState(): Promise<BridgeState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as BridgeState
  } catch {
    return null
  }
}

type BridgeSample = { ts: string; status: string | null; projection: number | null; usage: number | null }

/** Fallback: legge l'ultimo sample del bridge dal JSONL. Usato solo se il
 *  file di stato non è disponibile (bridge V5 vecchio, o cold-start prima
 *  che il bridge V6 abbia scritto il primo state). */
async function readLastBridgeSample(): Promise<BridgeSample | null> {
  let raw: string
  try { raw = await fs.readFile(DATA_JSONL, 'utf-8') }
  catch { return null }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const e = JSON.parse(line) as { source?: string; ts?: string; status?: string; projection?: number; usage?: number }
      if (e.source === 'bridge' && typeof e.ts === 'string') {
        return {
          ts: e.ts,
          status: e.status ?? null,
          projection: typeof e.projection === 'number' ? e.projection : null,
          usage: typeof e.usage === 'number' ? e.usage : null,
        }
      }
    } catch { /* skip */ }
  }
  return null
}

export async function GET() {
  const [status, bridgeState] = await Promise.all([isBridgeRunning(), readBridgeState()])

  // Path veloce: state file presente e fresco → usa direttamente i suoi
  // campi. Niente più replica della logica del bridge in TS.
  if (bridgeState && bridgeState.updated_at && status.running) {
    const updatedAt = Date.parse(bridgeState.updated_at)
    const fresh = Number.isFinite(updatedAt) && (Date.now() - updatedAt) < STATE_STALE_MS
    if (fresh) {
      const intervalMin = bridgeState.tick_interval_min ?? FALLBACK_TICK_MIN
      return NextResponse.json({
        ...status,
        lastTickAt: bridgeState.last_tick_at ?? null,
        lastStatus: bridgeState.last_status ?? null,
        lastProjection: bridgeState.last_projection ?? null,
        lastUsage: bridgeState.last_usage ?? null,
        nextTickAt: bridgeState.next_tick_at ?? null,
        intervalMs: Math.round(intervalMin * 60_000),
        intervalMin,
        tickPhase: bridgeState.tick_phase ?? null,
        gSpot: bridgeState.g_spot ?? null,
        sentinellaCooldownMin: bridgeState.sentinella_cooldown_min ?? null,
        source: 'state-file',
      })
    }
  }

  // Fallback: nessun state file utile. Stima dal JSONL con DEFAULT_TICK_MIN
  // (3 min). Non replichiamo la state machine: se il bridge V6 è stato
  // killato da > STATE_STALE_MS, mostriamo solo "running=false" / nextTickAt=null.
  const lastSample = await readLastBridgeSample()
  const lastTickAt = lastSample?.ts ?? null
  const intervalMs = Math.round(FALLBACK_TICK_MIN * 60_000)
  const nextTickAt = lastTickAt && status.running
    ? new Date(new Date(lastTickAt).getTime() + intervalMs).toISOString()
    : null
  return NextResponse.json({
    ...status,
    lastTickAt,
    lastStatus: lastSample?.status ?? null,
    lastProjection: lastSample?.projection ?? null,
    lastUsage: lastSample?.usage ?? null,
    nextTickAt,
    intervalMs,
    intervalMin: FALLBACK_TICK_MIN,
    tickPhase: null,
    gSpot: null,
    sentinellaCooldownMin: null,
    source: 'jsonl-fallback',
  })
}
// trigger HMR 1777586237
