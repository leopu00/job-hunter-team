import { NextResponse } from 'next/server'
import {
  JHT_HOME,
  JHT_CONFIG_PATH,
  JHT_DB_PATH,
  JHT_USER_DIR,
  getAgentDir,
} from '@/lib/jht-paths'
import { runBash } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'
import path from 'path'
import fs from 'fs'

export const dynamic = 'force-dynamic'

const TEAM = [
  { role: 'alfa',       session: 'ALFA',        effort: 'high',   instance: null as string | null },
  { role: 'scout',      session: 'SCOUT-1',     effort: 'high',   instance: '1' },
  { role: 'analista',   session: 'ANALISTA-1',  effort: 'high',   instance: '1' },
  { role: 'scorer',     session: 'SCORER-1',    effort: 'medium', instance: '1' },
  { role: 'scrittore',  session: 'SCRITTORE-1', effort: 'high',   instance: '1' },
  { role: 'critico',    session: 'CRITICO',     effort: 'high',   instance: null },
  { role: 'sentinella', session: 'SENTINELLA',  effort: 'low',    instance: null },
]

function shellEscape(value: string): string {
  return String(value).replace(/'/g, "'\\''")
}

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
    const repoRoot = path.resolve(process.cwd(), '..')
    const results: { session: string; role: string; status: 'started' | 'already_active' | 'error'; error?: string }[] = []

    for (const agent of TEAM) {
      const agentDir = getAgentDir(agent.role, agent.instance ?? undefined)
      const claudeMd = path.join(agentDir, 'CLAUDE.md')
      const templatePath = path.join(repoRoot, 'agents', agent.role, `${agent.role}.md`)

      fs.mkdirSync(agentDir, { recursive: true })

      if (!fs.existsSync(claudeMd)) {
        if (fs.existsSync(templatePath) && fs.statSync(templatePath).size > 0) {
          fs.copyFileSync(templatePath, claudeMd)
        } else {
          fs.writeFileSync(claudeMd, minimalClaudeMd(agent.role))
        }
      }

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

      try {
        await runBash(`tmux new-session -d -s "${agent.session}" -c "${agentDir}"`)

        const envVars: Record<string, string> = {
          JHT_HOME,
          JHT_USER_DIR,
          JHT_DB: JHT_DB_PATH,
          JHT_CONFIG: JHT_CONFIG_PATH,
          JHT_AGENT_DIR: agentDir,
        }
        for (const [k, v] of Object.entries(envVars)) {
          await runBash(`tmux send-keys -t "${agent.session}" "export ${k}='${shellEscape(v)}'" C-m`)
        }

        await runBash(
          `tmux send-keys -t "${agent.session}" "claude --dangerously-skip-permissions --effort ${agent.effort}" C-m`
        )
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
