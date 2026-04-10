import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import { getAgentDir } from '@/lib/jht-paths'
import { parseJsonl } from '@/lib/agent-chat'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

function getChatFile(): string {
  return path.join(getAgentDir('alfa'), 'chat.jsonl')
}

/** GET — leggi messaggi */
export async function GET(req: NextRequest) {
  const chatFile = getChatFile()
  const after = parseFloat(req.nextUrl.searchParams.get('after') ?? '0')

  try {
    if (!fs.existsSync(chatFile)) return NextResponse.json({ messages: [] })
    const content = fs.readFileSync(chatFile, 'utf-8')
    const messages = parseJsonl(content).filter(m => m.ts > after)
    return NextResponse.json({ messages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}

/** DELETE — pulisci la chat */
export async function DELETE() {
  const chatFile = getChatFile()
  if (fs.existsSync(chatFile)) {
    fs.writeFileSync(chatFile, '', 'utf-8')
  }
  return NextResponse.json({ ok: true })
}

/** POST — invia messaggio utente */
export async function POST(req: NextRequest) {
  const { text } = await req.json()
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'empty message' }, { status: 400 })
  }

  const chatFile = getChatFile()

  try {
    const msg = JSON.stringify({ role: 'user', text: text.trim(), ts: Date.now() / 1000 })
    fs.mkdirSync(path.dirname(chatFile), { recursive: true })
    fs.appendFileSync(chatFile, msg + '\n', 'utf-8')

    // Invia via tmux con prefisso protocollo chat
    const safe = text.trim().replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`')
    await runBash(`tmux send-keys -t ALFA -- '[@utente -> @capitano] [CHAT] ${safe}'`)
    await runBash(`tmux send-keys -t ALFA Enter`)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'send failed' }, { status: 500 })
  }
}
