import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

const VALID_SESSION = /^[A-Z][A-Z0-9_-]*$/i

export async function POST(req: NextRequest) {
  const { session, message } = await req.json()
  if (!VALID_SESSION.test(session ?? '')) {
    return NextResponse.json({ error: 'invalid session' }, { status: 400 })
  }
  if (typeof message !== 'string' || message.length > 1000) {
    return NextResponse.json({ error: 'invalid message' }, { status: 400 })
  }

  const escaped = message.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`')
  try {
    await runBash(`tmux send-keys -t "${session}" -- '${escaped}'`)
    await runBash(`tmux send-keys -t "${session}" Enter`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'send failed' }, { status: 500 })
  }
}
