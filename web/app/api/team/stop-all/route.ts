import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

const SESSIONS = [
  'ALFA', 'SCOUT-1', 'ANALISTA-1', 'SCORER-1', 'SCRITTORE-1', 'CRITICO', 'SENTINELLA',
]

export async function POST() {
  try {
    const results: { session: string; status: 'killed' | 'not_active' | 'error'; error?: string }[] = []

    for (const session of SESSIONS) {
      try {
        const { stdout } = await runBash(
          `tmux has-session -t "${session}" 2>&1 && echo "EXISTS" || echo "NONE"`
        )
        if (stdout.trim() !== 'EXISTS') {
          results.push({ session, status: 'not_active' })
          continue
        }
        await runBash(`tmux kill-session -t "${session}"`)
        results.push({ session, status: 'killed' })
      } catch (err: any) {
        results.push({ session, status: 'error', error: err?.message })
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Stop team fallito' },
      { status: 500 }
    )
  }
}
