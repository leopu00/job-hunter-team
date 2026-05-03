import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// Velocità per agente + tabella throttle pre-calcolata. Pensata per essere
// consumata dal Capitano (decide quale agente rallentare e di quanto senza
// fare matematica) e dalla UI /team. La logica vive in
// shared/skills/agent-speed-table.py — riusa la pipeline di token-by-agent
// + lo stato del bridge per Δusage.

const SCRIPT_PATH = '/app/shared/skills/agent-speed-table.py'

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampFloat(raw: string | null, fallback: number, min: number, max: number) {
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sinceMin = clampInt(url.searchParams.get('sinceMin'), 180, 5, 24 * 60)
  const minPctH = clampFloat(url.searchParams.get('minPctH'), 0.2, 0, 100)

  try {
    const { stdout } = await runBash(
      `python3 ${SCRIPT_PATH} --since-min=${sinceMin} --min-pct-h=${minPctH}`,
    )
    const data = JSON.parse(stdout)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
