import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

/** Leggi JHT_WORKSPACE dal .env (lato Node, no bash) */
function getWorkspace(): string | null {
  try {
    const envFile = path.resolve(process.cwd(), '..', '.env')
    const content = fs.readFileSync(envFile, 'utf-8')
    const match = content.match(/^JHT_WORKSPACE=(.+)$/m)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function getChatFile(): string | null {
  const ws = getWorkspace()
  if (!ws) return null
  return path.join(ws, 'assistente', 'chat.jsonl')
}

/** GET — leggi messaggi */
export async function GET(req: NextRequest) {
  const chatFile = getChatFile()
  if (!chatFile) return NextResponse.json({ messages: [] })

  const after = parseFloat(req.nextUrl.searchParams.get('after') ?? '0')

  try {
    if (!fs.existsSync(chatFile)) return NextResponse.json({ messages: [] })
    const content = fs.readFileSync(chatFile, 'utf-8')
    const messages = content.trim().split('\n').filter(Boolean)
      .map(line => {
        try {
          // Rimuovi escape invalidi tipo \! \' etc che Claude mette
          const clean = line.replace(/\\([^"\\\/bfnrtu])/g, '$1')
          return JSON.parse(clean)
        } catch { return null }
      })
      .filter((m): m is { role: string; text: string; ts: number } => m !== null)
      .filter(m => m.ts > after)

    return NextResponse.json({ messages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}

/** POST — invia messaggio utente */
export async function POST(req: NextRequest) {
  const { text } = await req.json()
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'empty message' }, { status: 400 })
  }

  const chatFile = getChatFile()
  if (!chatFile) {
    return NextResponse.json({ error: 'workspace not configured' }, { status: 500 })
  }

  try {
    // Scrivi nel chat file (Node diretto, niente bash)
    const msg = JSON.stringify({ role: 'user', text: text.trim(), ts: Date.now() / 1000 })
    fs.mkdirSync(path.dirname(chatFile), { recursive: true })
    fs.appendFileSync(chatFile, msg + '\n', 'utf-8')

    // Manda via tmux
    const safe = text.trim().replace(/'/g, "'\\''")
    await runBash(`tmux send-keys -t ASSISTENTE '${safe}' Enter`)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'send failed' }, { status: 500 })
  }
}
