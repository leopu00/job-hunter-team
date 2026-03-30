import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import { getWorkspacePath } from '@/lib/workspace'
import { parseJsonl } from '@/lib/agent-chat'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

async function getChatFile(): Promise<string | null> {
  const ws = await getWorkspacePath()
  if (!ws) return null
  return path.join(ws, 'assistente', 'chat.jsonl')
}

/** GET — leggi messaggi */
export async function GET(req: NextRequest) {
  const chatFile = await getChatFile()
  if (!chatFile) return NextResponse.json({ messages: [] })

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
  const chatFile = await getChatFile()
  if (chatFile && fs.existsSync(chatFile)) {
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

  const chatFile = await getChatFile()
  if (!chatFile) {
    return NextResponse.json({ error: 'workspace not configured' }, { status: 500 })
  }

  try {
    // Scrivi nel chat file (Node diretto, niente bash)
    const msg = JSON.stringify({ role: 'user', text: text.trim(), ts: Date.now() / 1000 })
    fs.mkdirSync(path.dirname(chatFile), { recursive: true })
    fs.appendFileSync(chatFile, msg + '\n', 'utf-8')

    // Invia via tmux con prefisso protocollo chat
    const safe = text.trim().replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`')
    await runBash(`tmux send-keys -t ASSISTENTE -- '[@utente -> @assistente] [CHAT] ${safe}'`)
    await runBash(`tmux send-keys -t ASSISTENTE Enter`)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'send failed' }, { status: 500 })
  }
}
