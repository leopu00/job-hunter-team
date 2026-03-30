import { NextResponse } from 'next/server'
import path from 'path'
import { runBash, runScript, toWslPath } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Controlla se SENTINELLA è già attiva
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'SENTINELLA')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Sentinella già attiva' })
    }

    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const scriptPath = toWslPath(script)

    await runScript(scriptPath, 'sentinella')

    return NextResponse.json({ ok: true, message: 'Sentinella avviata' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
