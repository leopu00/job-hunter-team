import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Controlla se la sessione ALFA è attiva
    const { stdout: sessions } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const active = sessions.trim().split('\n').some(s => s.trim() === 'ALFA')

    if (!active) {
      return NextResponse.json({ active: false, output: '' })
    }

    // Cattura output terminale (ultime 200 righe)
    const { stdout: output } = await execAsync(
      'tmux capture-pane -t "ALFA" -p -S -200 2>/dev/null || echo ""'
    )

    return NextResponse.json({ active: true, output })
  } catch {
    return NextResponse.json({ active: false, output: '' })
  }
}
