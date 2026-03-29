import { NextResponse } from 'next/server'
import path from 'path'
import { runBash, runScript, toWslPath } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    // Controlla se ASSISTENTE è già attivo
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'ASSISTENTE')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Assistente già attivo' })
    }

    // Workspace dal body (opzionale — lo script lo legge da .env se non passato)
    const body = await req.json().catch(() => ({}))
    const workspace = body.workspace as string | undefined

    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const scriptPath = toWslPath(script)

    // Se il workspace è passato, lo setta come env var per lo script
    if (workspace) {
      const envFile = path.join(repoRoot, '.env')
      const envPath = toWslPath(envFile)
      // Aggiorna o crea JHT_WORKSPACE nel .env
      await runBash(
        `grep -q '^JHT_WORKSPACE=' "${envPath}" 2>/dev/null && ` +
        `sed -i 's|^JHT_WORKSPACE=.*|JHT_WORKSPACE=${workspace}|' "${envPath}" || ` +
        `echo 'JHT_WORKSPACE=${workspace}' >> "${envPath}"`
      )
    }

    await runScript(scriptPath, 'assistente')

    return NextResponse.json({ ok: true, message: 'Assistente avviato' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
