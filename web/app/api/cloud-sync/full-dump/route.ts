import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/cloud-sync/auth'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/cloud-sync/full-dump
//
// Disaster recovery endpoint: ritorna lo snapshot di positions / scores /
// applications per l'utente autenticato via bearer token. Usato da
// `jht cloud restore` per ricostruire SQLite locale dopo un wipe (disco
// pieno, container corrotto, reset onboarding parziale).
//
// Scope MVP: 3 tabelle. companies e position_highlights sono escluse —
// richiederebbero mapping UUID→legacy_id non banale (companies ha solo
// name come identifier stabile cloud↔locale; highlights ha FK su
// position_id UUID). L'Analista le ripopola autonomamente nel normal
// loop dopo il restore. Follow-up tracciato.
//
// Differenze vs pull-desired-state (mig 024 + 027):
//   - pull-desired-state ritorna SOLO i flag user-driven (write/geocode_
//     requested) per finestra `since` e UPDATE-a SQLite esistente.
//   - full-dump ritorna TUTTI i campi delle 3 tabelle vive (deleted_at
//     IS NULL) — è una sostituzione, non un merge per-row.
//
// Safety cap: 10000 righe per tabella. Oltre, ritorna 413 con istruzioni
// per usare push delta inverso (out-of-scope MVP). Tipica session beta è
// <1000 positions, quindi 10000 è ampiamente sufficiente.
//
// Auth: Bearer jht_sync_ token (stesso schema di push/pull). Rate limit
// 5/min/token: il restore è operazione rara, ma cap basso protegge da
// abuso e da retry loop accidentali.

const ROW_CAP_PER_TABLE = 10_000

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req)
  if (!auth.ok) return auth.res
  const { userId, admin, tokenId } = auth.data

  const rl = await checkCloudSyncRateLimit('full-dump', tokenId, 5)
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate limited', retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  // SELECT * per tabella, filtrando per user_id e righe vive (deleted_at
  // IS NULL). Tutte e 3 le tabelle hanno deleted_at (mig 025 tombstones).
  const tables = ['positions', 'scores', 'applications'] as const
  const dump: Record<string, unknown[]> = {}
  const totals: Record<string, number> = {}

  for (const table of tables) {
    const { data, error } = await admin
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .limit(ROW_CAP_PER_TABLE + 1)
    if (error) {
      return NextResponse.json(
        { ok: false, error: `${table} dump failed: ${error.message}` },
        { status: 500 },
      )
    }
    const rows = data || []
    if (rows.length > ROW_CAP_PER_TABLE) {
      return NextResponse.json(
        {
          ok: false,
          error: `${table} oltre cap di ${ROW_CAP_PER_TABLE} righe (full-dump non supporta paginazione in MVP)`,
        },
        { status: 413 },
      )
    }
    dump[table] = rows
    totals[table] = rows.length
  }

  return NextResponse.json({
    ok: true,
    dump,
    totals,
    dumped_at: new Date().toISOString(),
  })
}
