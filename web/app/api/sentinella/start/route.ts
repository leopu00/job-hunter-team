import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'path'
import { runBash, runScript, toWslPath } from '@/lib/shell'
import { JHT_CONFIG_PATH } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

// Quote POSIX-safe per env var inline.
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

async function readTickMinutes(): Promise<number> {
  try {
    const raw = await fs.readFile(JHT_CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    const n = Number(cfg?.sentinella_tick_minutes)
    if (Number.isFinite(n) && n >= 1 && n <= 60) return Math.round(n)
  } catch { /* fallback */ }
  return 10
}

export async function POST() {
  try {
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const already = sessions.trim().split('\n').some(s => s.trim() === 'SENTINELLA')

    if (already) {
      return NextResponse.json({ ok: true, message: 'Sentinella già attiva' })
    }

    const repoRoot = path.resolve(process.cwd(), '..')
    const scriptPath = toWslPath(path.join(repoRoot, '.launcher', 'start-agent.sh'))

    const tickMin = await readTickMinutes()
    // runScript non supporta env var custom: usiamo runBash con prefisso
    // KEY='VAL' bash <script> <arg> per passare JHT_TICK_INTERVAL al
    // sentinel-ticker.py spawnato dentro start-agent.sh.
    await runBash(
      `JHT_TICK_INTERVAL=${shellQuote(String(tickMin))} bash ${shellQuote(scriptPath)} sentinella`
    )

    return NextResponse.json({ ok: true, message: 'Sentinella avviata', tick_minutes: tickMin })
  } catch (err: any) {
    console.error('[sentinella/start]', err)
    return NextResponse.json(
      { ok: false, error: 'Errore nell\'avvio della Sentinella, riprova' },
      { status: 500 }
    )
  }
}
