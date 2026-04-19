import { NextResponse } from 'next/server'
import { runBash, runScript } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'
import path from 'path'

export const dynamic = 'force-dynamic'

// Bootstrap minimale del team: Capitano + Assistente.
// Il resto della pipeline (Scout, Analista, Scorer, Scrittore, Critico,
// Sentinella) NON viene avviato da qui: è responsabilità del Capitano
// decidere quando accenderlo, in base al riempimento del DB (scaling
// graduale documentato in agents/capitano/capitano.md).
// Prima questa route avviava tutti e 7 gli agenti in un colpo,
// saturando Colima e bypassando la logica del Capitano.
const TEAM = [
  { role: 'capitano',   session: 'CAPITANO',   instance: null as string | null },
  { role: 'assistente', session: 'ASSISTENTE', instance: null as string | null },
]

export async function POST() {
  const authError = await requireAuth()
  if (authError) return authError

  try {
    const repoRoot = path.resolve(process.cwd(), '..')
    // Deleghiamo tutto a .launcher/start-agent.sh: template copy,
    // env var, rilevamento provider (claude/kimi/codex) dal
    // jht.config.json, creazione sessione tmux, lancio CLI.
    // Prima questa route aveva una logica inline che hardcodava
    // `claude --dangerously-skip-permissions`, ignorando il provider
    // scelto dall'utente — risultato: con kimi configurato, tutti gli
    // agenti partivano con `claude: command not found`.
    const startAgentScript = path.join(repoRoot, '.launcher', 'start-agent.sh')
    const results: { session: string; role: string; status: 'started' | 'already_active' | 'error'; error?: string }[] = []

    for (const agent of TEAM) {
      try {
        const { stdout } = await runBash(
          `tmux has-session -t "${agent.session}" 2>&1 && echo "EXISTS" || echo "NEW"`
        )
        if (stdout.trim() === 'EXISTS') {
          results.push({ session: agent.session, role: agent.role, status: 'already_active' })
          continue
        }
      } catch { /* sessione non esiste, procedi */ }

      try {
        const args = agent.instance ? [agent.role, agent.instance] : [agent.role]
        await runScript(startAgentScript, ...args)
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
