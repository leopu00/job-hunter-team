import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Controlla se ALFA è già attivo
    const { stdout: sessions } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'ALFA')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Capitano già attivo' })
    }

    // Avvia tramite lo script del team
    const home = process.env.HOME ?? '/Users/leoneemanuelpuglisi'
    const script = path.join(home, 'Repos/job-hunter-team/main/.dev-team/start-agent.sh')

    await execAsync(`bash "${script}" alfa`)

    return NextResponse.json({ ok: true, message: 'Capitano avviato' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
