import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// Sessioni che NON fermiamo con "Stop team" (sopravvivono al ciclo).
// ASSISTENTE è la chat utente, deve stare sempre attiva; viene spenta solo
// chiudendo il container dall'app Desktop.
const KEEP_ALIVE = new Set(['ASSISTENTE'])

export async function POST() {
  try {
    // Lista dinamica via `tmux ls`: prende tutte le sessioni live,
    // inclusi gli spawn dinamici del Capitano (SCOUT-2, ANALISTA-2, ...).
    // Prima c'era una lista hardcoded che mancava questi casi e lasciava
    // processi zombie. Killiamo anche il sentinel-bridge.py se gira, cosi'
    // al prossimo Avvia team non si accavallano piu' bridge.
    const { stdout } = await runBash(`tmux ls -F '#{session_name}' 2>/dev/null || true`)
    const sessions = stdout
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !KEEP_ALIVE.has(s))

    const results: { session: string; status: 'killed' | 'error'; error?: string }[] = []

    for (const session of sessions) {
      try {
        await runBash(`tmux kill-session -t "${session}" 2>&1`)
        results.push({ session, status: 'killed' })
      } catch (err: any) {
        results.push({ session, status: 'error', error: err?.message })
      }
    }

    // Kill eventuale sentinel-bridge.py residuo (best-effort): il bridge
    // è spawnato via setsid da start-agent.sh e non muore quando kill-session
    // chiude la SENTINELLA; senza pkill resterebbe appeso a scrivere tick
    // su una sessione morta, e al prossimo Start team partirebbe un secondo
    // bridge in parallelo (duplicati nel sentinel-data.jsonl).
    try {
      await runBash(`pkill -f sentinel-bridge.py 2>&1 || true`)
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      results,
      kept_alive: Array.from(KEEP_ALIVE),
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Stop team fallito' },
      { status: 500 }
    )
  }
}
