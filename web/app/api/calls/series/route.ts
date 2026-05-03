import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// Serie temporale del numero di CHIAMATE API team aggregate. Il rate limit
// Kimi Code è basato su chiamate per finestra (300-1200 / 5h), non su
// token: questo endpoint è la sorgente per il chart che mostra il vero rate.

const SCRIPT_PATH = '/app/shared/skills/team-calls-series.py'

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sinceMin = clampInt(url.searchParams.get('sinceMin'), 180, 1, 24 * 60)
  const bucketSec = clampInt(url.searchParams.get('bucketSec'), 60, 1, 600)

  try {
    const { stdout } = await runBash(
      `python3 ${SCRIPT_PATH} --since-min=${sinceMin} --bucket-sec=${bucketSec}`,
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
