import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await runBash('tmux kill-session -t ASSISTENTE 2>/dev/null')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
