import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await runBash('tmux kill-session -t ASSISTENTE 2>/dev/null')
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    // Sessione non trovata = idempotente, ok
    if (msg.includes('session not found') || msg.includes('no server running')) {
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: msg || 'stop failed' }, { status: 500 })
  }
}
