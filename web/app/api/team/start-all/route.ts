import { NextResponse } from 'next/server'
import { runBash, runScript } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'
import path from 'path'

export const dynamic = 'force-dynamic'

// Bootstrap minimale del team:
//   - Capitano: il coordinatore che poi spawna gli altri agenti (scaling
//     graduale definito nel suo prompt). start-agent.sh gli invia anche
//     un kick-off message automatico dopo ~15s di boot del CLI.
//   - Sentinella: monitor rate-limit/budget in modalita' Vigil. Parte con
//     un worker (SENTINELLA-WORKER) e un ticker esterno che ogni 10 min
//     le invia un [TICK] via jht-tmux-send.
// L'Assistente viene avviato dal boot dell'app Desktop (Electron →
// container.js), duplicarlo qui non serve. Gli altri ruoli (Scout,
// Analista, Scorer, Scrittore, Critico) vengono accesi dal Capitano
// secondo le sue soglie.
const TEAM: Array<{
  role: string
  session: string
  instance: string | null
  env?: Record<string, string>
}> = [
  { role: 'capitano', session: 'CAPITANO', instance: null },
  { role: 'sentinella', session: 'SENTINELLA', instance: null, env: { JHT_TICK_INTERVAL: '10' } },
]

// Quote POSIX-safe per env var passate a bash -c.
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

export async function POST() {
  const authError = await requireAuth()
  if (authError) return authError

  try {
    const repoRoot = path.resolve(process.cwd(), '..')
    // Deleghiamo tutto a .launcher/start-agent.sh: template copy,
    // env var, rilevamento provider (claude/kimi/codex) dal
    // jht.config.json, creazione sessione tmux, lancio CLI, kick-off
    // automatico per capitano e assistente, worker+ticker per sentinella.
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
        if (agent.env && Object.keys(agent.env).length > 0) {
          // Passiamo env var inline prima di invocare lo script. runScript
          // non supporta env custom, usiamo runBash con prefisso KEY=VAL.
          const envPrefix = Object.entries(agent.env)
            .map(([k, v]) => `${k}=${shellQuote(v)}`)
            .join(' ')
          const args = agent.instance ? [agent.role, agent.instance] : [agent.role]
          const argsStr = args.map(shellQuote).join(' ')
          await runBash(`${envPrefix} bash ${shellQuote(startAgentScript)} ${argsStr}`)
        } else {
          const args = agent.instance ? [agent.role, agent.instance] : [agent.role]
          await runScript(startAgentScript, ...args)
        }
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
