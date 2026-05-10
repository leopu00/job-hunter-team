import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// Pause `throttle` applicate dagli agenti nel tempo.
// Fonte: $JHT_HOME/logs/throttle-events.jsonl (scritto dalla skill
// shared/skills/throttle.py ogni volta che un agente chiama jht-throttle).
// L'aggregazione vive nello script python — niente replica TS.

const SCRIPT_PATH = '/app/shared/skills/throttle-series.py'

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
