import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/team-state/auth'

export const dynamic = 'force-dynamic'

// Heartbeat più vecchio di questa soglia → considerato libero (device sparito senza graceful shutdown).
// Allineato col reconciler che fa heartbeat ogni 30s; 5min = 10 cicli persi.
const HEARTBEAT_STALE_MS = 5 * 60 * 1000

/**
 * Claim del team_state per il device corrente.
 *
 * Enforcement single-team (regola lockata vps.md:392):
 *   - Se non esiste team_state row → CREATE + assign active_device_id
 *   - Se active_device_id == token.id → noop (idempotente)
 *   - Se active_device_id != token.id e heartbeat <5min → 409 (occupato)
 *       force=true override + notifica al device perdente
 *   - Se active_device_id != token.id e heartbeat >5min o null → ok (stale lock)
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveUser(req)
  if (!resolved.ok) return resolved.res
  if (resolved.user.source !== 'token') {
    return NextResponse.json({ error: 'Solo i container con token possono claimare' }, { status: 403 })
  }
  const { userId, token, supabase } = resolved.user

  let body: { force?: unknown; device_label?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // body opzionale
  }
  const force = body.force === true
  const deviceLabel =
    typeof body.device_label === 'string' && body.device_label.length <= 120
      ? body.device_label
      : null

  // 1. Leggi stato attuale
  const existing = (await supabase
    .from('team_state')
    .select('active_device_id, active_device_claimed_at, last_heartbeat_at')
    .eq('user_id', userId)
    .maybeSingle()) as {
    data: {
      active_device_id: string | null
      active_device_claimed_at: string | null
      last_heartbeat_at: string | null
    } | null
    error: { message: string } | null
  }

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 })
  }

  const current = existing.data

  // 2. Check conflict: altro device active, heartbeat recente, no force
  if (
    current &&
    current.active_device_id &&
    current.active_device_id !== token.tokenId &&
    !force
  ) {
    const hbAt = current.last_heartbeat_at ? new Date(current.last_heartbeat_at).getTime() : 0
    const hbAge = Date.now() - hbAt
    if (hbAge < HEARTBEAT_STALE_MS) {
      return NextResponse.json(
        {
          error: 'device_already_claimed',
          message:
            "Un altro device ha già il claim attivo del team. Usa force=true per evictarlo (notifica inviata) oppure aspetta " +
            Math.ceil((HEARTBEAT_STALE_MS - hbAge) / 1000) +
            's per la scadenza automatica del lock.',
          current_device_id: current.active_device_id,
          claimed_at: current.active_device_claimed_at,
          last_heartbeat_at: current.last_heartbeat_at,
          heartbeat_age_seconds: Math.floor(hbAge / 1000),
        },
        { status: 409 }
      )
    }
  }

  // 3. Eviction notice: se sto sovrascrivendo un device active diverso, notifica
  const willEvict =
    current && current.active_device_id && current.active_device_id !== token.tokenId
  if (willEvict) {
    await supabase
      .from('pending_user_messages')
      .insert({
        user_id: userId,
        agent: 'cloud-sync',
        body:
          `Il team è stato attivato su un altro device (${deviceLabel ?? token.name}). ` +
          `Questo device (id ${current!.active_device_id?.slice(0, 8)}…) non è più autoritativo: i suoi push verranno rifiutati con 409. ` +
          `Per riprendere il controllo: jht cloud team-state-listen oppure clicca Start dalla dashboard.`,
        kind: 'eviction',
      })
      // best-effort, non bloccare il claim se notifica fallisce
      .then(() => {}, () => {})
  }

  // 4. Upsert (CREATE o sovrascrivi active_device_id)
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('team_state')
    .upsert(
      {
        user_id: userId,
        active_device_id: token.tokenId,
        active_device_claimed_at: now,
        last_heartbeat_at: now,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    state: data,
    claimed_device_id: token.tokenId,
    evicted_device_id: willEvict ? current!.active_device_id : null,
  })
}
