import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// Serie temporale dei 4 TIPI di token consumati dal team aggregato.
// Sorgente: ~/.kimi/sessions/*/wire.jsonl + ~/.claude/projects/*/jsonl
// (provider attivi). L'aggregazione è in shared/skills/team-tokens-by-type.py
// per non duplicare in TS la logica di lettura dei log locali.

const SCRIPT_PATH = '/app/shared/skills/team-tokens-by-type.py'

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
