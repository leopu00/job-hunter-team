import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import { getAgentDir } from '@/lib/jht-paths'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { message?: string; messages?: { role: string; content: string }[]; profile?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  // Estrai il messaggio utente (supporta sia singolo che array)
  let text: string
  if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1]
    text = last.content?.trim() ?? ''
  } else if (typeof body.message === 'string') {
    text = body.message.trim()
  } else {
    return NextResponse.json({ error: 'message o messages richiesto' }, { status: 400 })
  }

  if (!text) {
    return NextResponse.json({ error: 'messaggio vuoto' }, { status: 400 })
  }

  try {
    // Scrivi messaggio utente nella chat dell'assistente (zona nascosta)
    const assistenteDir = getAgentDir('assistente')
    fs.mkdirSync(assistenteDir, { recursive: true })
    const chatFile = path.join(assistenteDir, 'chat.jsonl')
    const userMsg = JSON.stringify({ role: 'user', text, ts: Date.now() / 1000 })
    fs.appendFileSync(chatFile, userMsg + '\n', 'utf-8')

    // Invia via tmux all'assistente con protocollo chat
    const safe = text.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`')
    await runBash(`tmux send-keys -t ASSISTENTE -- '[@utente -> @assistente] [CHAT] ${safe}'`)
    await runBash(`tmux send-keys -t ASSISTENTE Enter`)

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invio fallito'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
