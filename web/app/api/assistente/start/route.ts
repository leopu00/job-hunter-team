import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
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

    // Se il workspace è passato, lo setta nel .env via Node fs (no shell injection)
    if (workspace && typeof workspace === 'string' && !workspace.includes('..')) {
      const envFile = path.join(repoRoot, '.env')
      try {
        let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : ''
        if (content.match(/^JHT_WORKSPACE=/m)) {
          content = content.replace(/^JHT_WORKSPACE=.*/m, `JHT_WORKSPACE=${workspace}`)
        } else {
          content += `\nJHT_WORKSPACE=${workspace}\n`
        }
        fs.writeFileSync(envFile, content, 'utf-8')
      } catch { /* non critico — lo script leggerà dal .env esistente */ }
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
