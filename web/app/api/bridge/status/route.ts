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

export async function GET() {
  const status = await isBridgeRunning()
  return NextResponse.json(status)
}
