import { NextResponse } from 'next/server'
import path from 'path'
import { runBash, runScript, toWslPath } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'ASSISTENTE')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Assistente già attivo' })
    }

    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const scriptPath = toWslPath(script)

    // start-agent.sh legge i path fissi da ~/.jht (JHT_HOME, JHT_USER_DIR, JHT_DB)
    await runScript(scriptPath, 'assistente')

    return NextResponse.json({ ok: true, message: 'Assistente avviato' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
