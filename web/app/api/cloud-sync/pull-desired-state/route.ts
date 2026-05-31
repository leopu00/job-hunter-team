import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/cloud-sync/auth'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/cloud-sync/pull-desired-state?since=<ISO>&limit=<n>
//
// Reverse del push: il container chiama questo endpoint per recuperare
// le intenzioni utente scritte direttamente dal browser su Supabase
// mentre il container era fermo o senza network. Caso d'uso primario:
// l'utente clicca "Scrivi CV" via web (in cloud-mode il bottone scrive
// solo su Supabase via `/api/positions/[legacyId]/write-request`), poi
// il container riavvia e qui legge i flag `write_requested` aggiornati.
//
// Scope MVP: solo `positions.write_requested` + `write_requested_at`.
// Pattern desired-state per-row, estendibile a `geocode_requested`
// (JHT-CLOUDSYNC-01 P1) e altri flag user-driven.
//
// Volume atteso: invocato al boot del team (jht team start) + opzionale
// tick nel daemon. Pull "tutto modificato in finestra" cap default 7gg
// con paginazione cursor-based (since param + has_more flag).
//
// Auth: Bearer jht_sync_ token (stesso schema di push/team-commands).
// Rate limit: 30/min/token — read-only, più alto del push (20/min).

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req)
  if (!auth.ok) return auth.res
  const { userId, admin, tokenId } = auth.data

  const rl = await checkCloudSyncRateLimit('pull-desired-state', tokenId, 30)
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate limited', retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const url = new URL(req.url)
  const sinceParam = url.searchParams.get('since')
  // Default lookback 7gg: prima invocazione assoluta o cursor cancellato
  // → evita full-table scan. 7gg copre downtime container realistici
  // (vacanze, restart prolungato) senza esplodere il payload.
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_LOOKBACK_MS)
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { ok: false, error: '`since` must be ISO 8601 timestamp' },
      { status: 400 },
    )
  }

  const limitRaw = parseInt(url.searchParams.get('limit') || '500', 10)
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 500), 2000)

  // Filtro intenzionalmente AMPIO: tutte le righe modificate dopo `since`,
  // anche con write_requested=FALSE. Cattura sia toggle-on (utente clicca
  // "Scrivi CV" via web) sia toggle-off (utente annulla via web mentre
  // container era offline). Senza il toggle-off, il container manterrebbe
  // write_requested=TRUE per sempre dopo un annulla via altro device.
  //
  // Proiezione lean: solo i 4 campi necessari al merge desired-state.
  // Volume tipico: <100 righe/boot anche su pool da 1000 positions
  // (le righe modificate sono già delta del push container→cloud).
  const { data, error } = await admin
    .from('positions')
    .select('legacy_id, write_requested, write_requested_at, updated_at')
    .eq('user_id', userId)
    .gt('updated_at', since.toISOString())
    .order('updated_at', { ascending: true })
    .limit(limit + 1)

  if (error) {
    return NextResponse.json(
      { ok: false, error: `query failed: ${error.message}` },
      { status: 500 },
    )
  }

  const rows = data || []
  const hasCompany = rows.length > limit
  const positions = hasCompany ? rows.slice(0, limit) : rows

  // Cursor = MAX(updated_at) tra le righe restituite. Se zero righe,
  // ritorniamo `since` invariato così il client non avanza inutilmente
  // (al prossimo pull rivede la stessa finestra). Le righe sono ordinate
  // ASC per updated_at, quindi MAX = ultima.
  const cursor =
    positions.length > 0
      ? positions[positions.length - 1].updated_at
      : since.toISOString()

  return NextResponse.json({
    ok: true,
    positions,
    cursor,
    has_more: hasCompany,
  })
}
