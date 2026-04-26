import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { runBash, runScript, toWslPath } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'
import { JHT_CONFIG_PATH } from '@/lib/jht-paths'
import path from 'path'

export const dynamic = 'force-dynamic'

// Bootstrap minimale del team:
//   - Capitano: il coordinatore che poi spawna gli altri agenti (scaling
//     graduale definito nel suo prompt). start-agent.sh gli invia anche
//     un kick-off message automatico dopo ~15s di boot del CLI. Insieme
//     al Capitano viene spawnato anche sentinel-bridge.py — il servizio
//     deterministico che monitora rate-limit + host e invia [BRIDGE ORDER]
//     al Capitano quando la policy cambia (T0..T4, edge-triggered).
// L'Assistente viene avviato dal boot dell'app Desktop (Electron →
// container.js), duplicarlo qui non serve. Gli altri ruoli (Scout,
// Analista, Scorer, Scrittore, Critico) vengono accesi dal Capitano
// secondo le sue soglie.
async function readSentinellaTickMinutes(): Promise<number> {
  // Tick idle (default 10 min, range 1-60): il bridge usa questo come
  // ceiling a riposo, ma adatta dinamicamente in alto (fino a 1 min)
  // quando status CRITICO / host saturo / team operativo attivo.
  try {
    const raw = await fs.readFile(JHT_CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    const n = Number(cfg?.sentinella_tick_minutes)
    if (Number.isFinite(n) && n >= 1 && n <= 60) return Math.round(n)
  } catch { /* fallback al default */ }
  return 10
}

type TeamAgent = {
  role: string
  session: string
  instance: string | null
  env?: Record<string, string>
  /** Sleep in ms PRIMA di lanciare questo agente (per dare tempo al
   *  predecessore di stabilizzarsi). 0 = parte subito. */
  preDelayMs?: number
  /** Se true, l'agente non è una sessione tmux (es. bridge background).
   *  Skippa il check has-session. */
  notATmuxSession?: boolean
}

async function buildTeam(): Promise<TeamAgent[]> {
  const tickMin = await readSentinellaTickMinutes()
  // Sequenza V5 ordinata (rivista 2026-04-26):
  //   1. SENTINELLA: tmux session + CLI boot + kick-off, da SOLA
  //      (così è pronta a ricevere il primo [BRIDGE TICK])
  //   2. BRIDGE: processo Python background, fa il primo fetch e manda
  //      il primo tick alla SENTINELLA che è già attiva
  //   3. CAPITANO: tmux session + CLI boot + kick-off, lanciato per
  //      ULTIMO così quando parte il monitoring è già stabile e ha
  //      almeno un sample fresco da consultare
  //
  // Pre-delay rivisti per PC lenti:
  //   • bridge:    20s dopo sentinella  (CLI boot lento + trust dialog)
  //   • capitano:   5s dopo bridge      (lascia che il primo fetch
  //                                      arrivi prima del kick-off)
  return [
    { role: 'sentinella', session: 'SENTINELLA', instance: null },
    { role: 'bridge',     session: 'BRIDGE',     instance: null,
      preDelayMs: 20000, notATmuxSession: true,
      env: { JHT_TARGET_SESSION: 'CAPITANO' } },
    { role: 'capitano',   session: 'CAPITANO',   instance: null,
      preDelayMs: 5000,
      env: { JHT_TICK_INTERVAL: String(tickMin) } },
  ]
}

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
    // automatico per capitano e assistente, spawn bridge rate-limit
    // al fianco del Capitano.
    const startAgentScript = toWslPath(path.join(repoRoot, '.launcher', 'start-agent.sh'))
    const team = await buildTeam()
    const results: { session: string; role: string; status: 'started' | 'already_active' | 'error'; error?: string }[] = []

    for (const agent of team) {
      // Pre-delay opzionale: lasciato al singolo agent (es. bridge attende
      // che capitano+sentinella siano stabili prima di partire).
      if (agent.preDelayMs && agent.preDelayMs > 0) {
        await new Promise((r) => setTimeout(r, agent.preDelayMs))
      }

      // I "ruoli" che NON sono sessioni tmux (es. bridge = processo
      // Python background) skippano il check has-session: start-agent.sh
      // gestisce il singleton internamente.
      if (!agent.notATmuxSession) {
        try {
          const { stdout } = await runBash(
            `tmux has-session -t "${agent.session}" 2>&1 && echo "EXISTS" || echo "NEW"`
          )
          if (stdout.trim() === 'EXISTS') {
            results.push({ session: agent.session, role: agent.role, status: 'already_active' })
            continue
          }
        } catch { /* sessione non esiste, procedi */ }
      }

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
