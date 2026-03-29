import { NextResponse } from 'next/server'
import path from 'path'
import { runBash, runScript, toWslPath } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Controlla se ALFA è già attivo
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'ALFA')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Capitano già attivo' })
    }

    // Rileva la root del repo (web/ è una dir sotto la root)
    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const scriptPath = toWslPath(script)

    await runScript(scriptPath, 'alfa')

    return NextResponse.json({ ok: true, message: 'Capitano avviato' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
