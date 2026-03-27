import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const active = sessions.trim().split('\n').some(s => s.trim() === 'ASSISTENTE')

    if (!active) {
      return NextResponse.json({ active: false, output: '' })
    }

    const { stdout: output } = await runBash(
      'tmux capture-pane -t "ASSISTENTE" -p -S -200 2>/dev/null || echo ""'
    )

    return NextResponse.json({ active: true, output })
  } catch {
    return NextResponse.json({ active: false, output: '' })
  }
}
