import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRecentlyTouchedPositions } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 100

// Le datetime in DB (positions.found_at, .last_checked, scores.scored_at)
// sono UTC ma scritte come `YYYY-MM-DD HH:MM:SS` senza suffisso `Z`. Sul
// client `Date.parse(...)` interpreta quella forma come ora locale, e su
// mac CEST tutto appare sfasato di 2h ("2h ago" su una riga appena
// inserita). Normalizziamo qui in ISO UTC prima di rispondere.
function toUtcIso(s: string | null | undefined): string | null {
  if (typeof s !== 'string' || s.length < 10) return s ?? null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s
  return s.replace(' ', 'T') + 'Z'
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied

  const url = new URL(req.url)
  const raw = url.searchParams.get('limit')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_LIMIT)
    : DEFAULT_LIMIT

  const positions = await getRecentlyTouchedPositions(limit)
  const normalized = positions.map((p: any) => ({
    ...p,
    found_at: toUtcIso(p.found_at),
    last_checked: toUtcIso(p.last_checked),
    scored_at: toUtcIso(p.scored_at),
    last_action_at: toUtcIso(p.last_action_at),
  }))
  return NextResponse.json({ positions: normalized, limit })
}
