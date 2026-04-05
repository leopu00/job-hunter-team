/**
 * API Route — /api/telegram
 *
 * GET  → stato del bridge Telegram (running, stats, bot username)
 * POST → start o stop del bridge
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const STATUS_FILE = path.join(os.homedir(), '.jht', 'telegram', 'bridge-status.json')

interface BridgeStatusFile {
  running: boolean
  mode: 'polling' | 'webhook'
  botUsername?: string
  startedAt?: number
  messagesReceived: number
  messagesSent: number
  errors: number
  pid?: number
}

function readStatus(): BridgeStatusFile {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      return { running: false, mode: 'polling', messagesReceived: 0, messagesSent: 0, errors: 0 }
    }
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) as BridgeStatusFile
    // Verifica se il processo è ancora attivo
    if (data.running && data.pid) {
      try {
        process.kill(data.pid, 0)
      } catch {
        data.running = false
      }
    }
    return data
  } catch {
    return { running: false, mode: 'polling', messagesReceived: 0, messagesSent: 0, errors: 0 }
  }
}

function writeStatus(status: BridgeStatusFile) {
  const dir = path.dirname(STATUS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

export async function GET() {
  const status = readStatus()
  return NextResponse.json({ status })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body non valido' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json(
      { error: 'action deve essere "start" o "stop"' },
      { status: 400 }
    )
  }

  const status = readStatus()

  if (action === 'start') {
    if (status.running) {
      return NextResponse.json({ ok: true, message: 'Bridge già attivo', status })
    }

    // Verifica token configurato
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
    if (!token) {
      return NextResponse.json(
        { error: 'TELEGRAM_BOT_TOKEN non configurato' },
        { status: 400 }
      )
    }

    // Avvia il bridge come processo separato
    const { spawn } = await import('child_process')
    const bridgeScript = path.join(process.cwd(), 'shared', 'telegram', 'index.ts')

    try {
      const child = spawn('npx', ['tsx', bridgeScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, TELEGRAM_BOT_TOKEN: token },
      })
      child.unref()

      const newStatus: BridgeStatusFile = {
        running: true,
        mode: 'polling',
        startedAt: Date.now(),
        messagesReceived: 0,
        messagesSent: 0,
        errors: 0,
        pid: child.pid,
      }
      writeStatus(newStatus)
      return NextResponse.json({ ok: true, message: 'Bridge avviato', status: newStatus })
    } catch (err) {
      return NextResponse.json(
        { error: `Errore avvio bridge: ${err}` },
        { status: 500 }
      )
    }
  }

  // Stop
  if (!status.running) {
    return NextResponse.json({ ok: true, message: 'Bridge già fermo', status })
  }

  if (status.pid) {
    try {
      process.kill(status.pid, 'SIGTERM')
    } catch { /* processo già terminato */ }
  }

  const stoppedStatus: BridgeStatusFile = { ...status, running: false }
  writeStatus(stoppedStatus)
  return NextResponse.json({ ok: true, message: 'Bridge fermato', status: stoppedStatus })
}
