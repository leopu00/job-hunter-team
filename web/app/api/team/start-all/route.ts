import { NextResponse } from 'next/server'
import { runBash, runScript } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'
import path from 'path'

export const dynamic = 'force-dynamic'

const TEAM = [
  { role: 'capitano',   session: 'CAPITANO',    instance: null as string | null },
  { role: 'scout',      session: 'SCOUT-1',     instance: '1' },
  { role: 'analista',   session: 'ANALISTA-1',  instance: '1' },
  { role: 'scorer',     session: 'SCORER-1',    instance: '1' },
  { role: 'scrittore',  session: 'SCRITTORE-1', instance: '1' },
  { role: 'critico',    session: 'CRITICO',     instance: null },
  { role: 'sentinella', session: 'SENTINELLA',  instance: null },
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
