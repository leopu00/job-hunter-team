import { NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace'
import { runBash } from '@/lib/shell'
import { requireAuth, isValidPath } from '@/lib/auth'
import path from 'path'
import fs from 'fs'

export const dynamic = 'force-dynamic'

const TEAM = [
  { role: 'alfa',       session: 'ALFA',        effort: 'high',   dir: 'alfa' },
  { role: 'scout',      session: 'SCOUT-1',     effort: 'high',   dir: 'scout-1' },
  { role: 'analista',   session: 'ANALISTA-1',  effort: 'high',   dir: 'analista-1' },
  { role: 'scorer',     session: 'SCORER-1',    effort: 'medium', dir: 'scorer-1' },
  { role: 'scrittore',  session: 'SCRITTORE-1', effort: 'high',   dir: 'scrittore-1' },
  { role: 'critico',    session: 'CRITICO',     effort: 'high',   dir: 'critico' },
  { role: 'sentinella', session: 'SENTINELLA',  effort: 'low',    dir: 'sentinella' },
]

const DESCRIPTIONS: Record<string, string> = {
  alfa:       'Coordini la pipeline di ricerca lavoro del team.',
  scout:      'Cerchi posizioni lavorative online e le inserisci nel database.',
  analista:   'Analizzi le job description e le aziende per estrarre requisiti chiave.',
  scorer:     'Calcoli il punteggio di match tra il profilo del candidato e le posizioni.',
  scrittore:  'Scrivi CV personalizzati e cover letter per ogni posizione.',
  critico:    'Revisioni la qualita dei CV e delle cover letter, fornendo feedback.',
  sentinella: 'Monitori il sistema, token usage, rate limit e stato degli agenti.',
}

const DISPLAY_NAMES: Record<string, string> = {
  alfa: 'Capitano (Alfa)', scout: 'Scout', analista: 'Analista',
  scorer: 'Scorer', scrittore: 'Scrittore', critico: 'Critico', sentinella: 'Sentinella',
}

function minimalClaudeMd(role: string): string {
  return `# ${DISPLAY_NAMES[role] ?? role}

Sei l'agente **${DISPLAY_NAMES[role] ?? role}** del Job Hunter Team.
${DESCRIPTIONS[role] ?? ''}

## Regole
- Comunica in italiano
- Lavora nella tua directory di workspace
- Collabora con gli altri agenti del team
`
}

export async function POST() {
  const authError = await requireAuth()
  if (authError) return authError

  try {
    const workspace = await getWorkspacePath()
    if (!workspace) {
      return NextResponse.json(
        { ok: false, error: 'Workspace non configurato. Seleziona una cartella dalla pagina principale.' },
        { status: 400 }
      )
    }

    if (!isValidPath(workspace)) {
      return NextResponse.json(
        { ok: false, error: 'Path workspace non valido' },
        { status: 400 }
      )
    }

    const repoRoot = path.resolve(process.cwd(), '..')
    const results: { session: string; role: string; status: 'started' | 'already_active' | 'error'; error?: string }[] = []

    for (const agent of TEAM) {
      const agentDir = path.join(workspace, agent.dir)
      const claudeMd = path.join(agentDir, 'CLAUDE.md')
      const templatePath = path.join(repoRoot, 'agents', agent.role, `${agent.role}.md`)

      // 1. Crea directory agente
      fs.mkdirSync(agentDir, { recursive: true })

      // 2. Crea CLAUDE.md se non presente
      if (!fs.existsSync(claudeMd)) {
        if (fs.existsSync(templatePath) && fs.statSync(templatePath).size > 0) {
          fs.copyFileSync(templatePath, claudeMd)
        } else {
          fs.writeFileSync(claudeMd, minimalClaudeMd(agent.role))
        }
      }

      // 3. Controlla se sessione tmux gia attiva
      try {
        const { stdout } = await runBash(
          `tmux has-session -t "${agent.session}" 2>&1 && echo "EXISTS" || echo "NEW"`
        )
        if (stdout.trim() === 'EXISTS') {
          results.push({ session: agent.session, role: agent.role, status: 'already_active' })
          continue
        }
      } catch {
        // Sessione non esiste, procedi
      }

      // 4. Avvia sessione tmux con claude CLI
      try {
        await runBash(`tmux new-session -d -s "${agent.session}" -c "${agentDir}"`)
        await runBash(
          `tmux send-keys -t "${agent.session}" "claude --dangerously-skip-permissions --effort ${agent.effort}" C-m`
        )
        // Auto-accept: invia Enter in background per accettare "Do you trust this folder?"
        // L'Enter extra e' innocuo se Claude e' gia' partito (input vuoto = ignorato)
        runBash(
          `(sleep 4 && tmux send-keys -t "${agent.session}" Enter && sleep 3 && tmux send-keys -t "${agent.session}" Enter) &>/dev/null &`
        ).catch(() => {})
        results.push({ session: agent.session, role: agent.role, status: 'started' })
      } catch (err: any) {
        results.push({ session: agent.session, role: agent.role, status: 'error', error: err?.message })
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Avvio team fallito' },
      { status: 500 }
    )
  }
}
