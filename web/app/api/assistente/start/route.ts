import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { runBash, runScript, toWslPath } from '@/lib/shell'
import { getWorkspacePath } from '@/lib/workspace'

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

    // Workspace: prima dal body, poi dal cookie, mai hardcoded
    const body = await req.json().catch(() => ({}))
    let workspace = body.workspace as string | undefined
    if (!workspace) {
      workspace = (await getWorkspacePath()) ?? undefined
    }

    if (!workspace) {
      return NextResponse.json(
        { ok: false, error: 'Nessun workspace configurato. Seleziona una cartella workspace.' },
        { status: 400 }
      )
    }

    if (workspace.includes('..')) {
      return NextResponse.json(
        { ok: false, error: 'Path workspace non valido' },
        { status: 400 }
      )
    }

    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const scriptPath = toWslPath(script)

    // Aggiorna SEMPRE il .env con il workspace corrente prima di avviare
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

    await runScript(scriptPath, 'assistente')

    return NextResponse.json({ ok: true, message: 'Assistente avviato' })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio fallito' },
      { status: 500 }
    )
  }
}
