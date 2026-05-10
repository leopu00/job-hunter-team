import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

// Log strutturato dei messaggi tra agenti, scritto da agents/_tools/jht-tmux-send.
// Ogni riga JSONL: { ts, session, from, to, type, preview }.
const LOG_PATH = path.join(
  process.env.JHT_HOME || path.join(os.homedir(), '.jht'),
  'logs',
  'messages.jsonl',
)

type Message = {
  ts: string
  session: string
  from: string
  to: string
  type: string
  preview: string
}

/**
 * GET /api/team/messages?since=<ISO-ts>
 * Ritorna le righe di messages.jsonl con ts > since.
 * Se since non passato, ritorna le ultime 50 righe (initial load).
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get('since')
  let raw = ''
  try {
    raw = await fs.readFile(LOG_PATH, 'utf-8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ messages: [], cursor: null })
    }
    throw e
  }
  const lines = raw.split('\n').filter(Boolean)
  const all: Message[] = []
  for (const line of lines) {
    try { all.push(JSON.parse(line) as Message) } catch { /* skip invalid */ }
  }
  const filtered = since
    ? all.filter((m) => m.ts > since)
    : all.slice(-50)
  const cursor = filtered.length > 0 ? filtered[filtered.length - 1].ts : since
  return NextResponse.json({ messages: filtered, cursor })
}
