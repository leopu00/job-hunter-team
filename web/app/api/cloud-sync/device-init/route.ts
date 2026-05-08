import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/workspace'
import {
  generateDeviceCode,
  generateUserCode,
  PAIRING_TTL_MS,
  PAIRING_POLL_INTERVAL_SEC,
} from '@/lib/cloud-sync/pairing'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

const NOT_CLOUD = NextResponse.json(
  { error: 'Cloud sync disponibile solo in modalità cloud' },
  { status: 400 }
)

// Init e' chiamato dal CLI all'avvio di `jht cloud login`. Una richiesta
// per pairing — non polling. Cap a 30/min per IP per limitare creazione
// di sessioni-zombie da bot.
const INIT_LIMIT_PER_MIN = 30

/**
 * POST /api/cloud-sync/device-init
 *
 * Endpoint pubblico (no auth): chiamato dal CLI `jht cloud login` per
 * iniziare il flow di pairing. Genera (device_code, user_code), li
 * inserisce in cloud_sync_pairing_sessions con status='pending', e
 * ritorna i parametri necessari al CLI per istruire l'utente:
 *
 *   - verification_url: dove l'utente deve andare nel browser
 *   - user_code: il codice human-readable da digitare lì
 *   - device_code: bearer-like, il CLI lo usa per polling
 *   - expires_in: secondi (sempre 600 = 10 min)
 *   - interval: secondi tra ogni poll (default 2)
 *
 * Sicurezza:
 * - device_code e' pseudo-bearer: chiunque ce l'abbia puo' fare polling
 *   ma SOLO l'utente loggato sul web puo' approvare digitando user_code.
 *   Quindi un attaccante che intercetta device_code NON ottiene token
 *   senza che l'utente legittimo confermi attivamente.
 * - Rate limit per IP per evitare floods.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD

  // Identifica IP per rate limiting (best-effort).
  const ipHeader = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  const ip = ipHeader.split(',')[0].trim() || 'unknown'

  const rl = await checkCloudSyncRateLimit('device-init', ip, INIT_LIMIT_PER_MIN)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit superato. Riprova tra poco.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': String(INIT_LIMIT_PER_MIN),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante' },
      { status: 500 },
    )
  }

  // Retry su collisione user_code (raro: ~18 miliardi possibili, MA con
  // 1000 sessioni concorrenti la probabilita' diventa non-trascurabile
  // per il birthday problem). Massimo 5 tentativi prima di arrendersi.
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
  let attempt = 0
  let inserted: { device_code: string; user_code: string } | null = null

  while (attempt < 5 && !inserted) {
    attempt++
    const device_code = generateDeviceCode()
    const user_code = generateUserCode()
    const { data, error } = await admin
      .from('cloud_sync_pairing_sessions')
      .insert({
        device_code,
        user_code,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('device_code, user_code')
      .single()

    if (error) {
      // 23505 = unique_violation (Postgres). Riprovo con nuovi codici.
      if (error.code === '23505') continue
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    inserted = data
  }

  if (!inserted) {
    return NextResponse.json(
      { error: 'impossibile generare un user_code unico, riprova' },
      { status: 503 },
    )
  }

  // Costruisci verification URL puntando alla pagina /cli-link.
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host') || 'jobhunterteam.ai'
  const verification_url = `${proto}://${host}/cli-link`

  return NextResponse.json({
    device_code: inserted.device_code,
    user_code: inserted.user_code,
    verification_url,
    verification_url_complete: `${verification_url}?code=${inserted.user_code}`,
    expires_in: Math.floor(PAIRING_TTL_MS / 1000),
    interval: PAIRING_POLL_INTERVAL_SEC,
  })
}
