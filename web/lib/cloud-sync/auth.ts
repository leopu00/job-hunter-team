import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashSyncToken } from '@/lib/cloud-sync/tokens'

const BEARER_RE = /^Bearer\s+(jht_sync_[A-Za-z0-9_\-]+)$/

export interface VerifiedToken {
  userId: string
  tokenId: string
  name: string
  admin: ReturnType<typeof createAdminClient>
}

export type VerifyResult = { ok: true; data: VerifiedToken } | { ok: false; res: NextResponse }

/**
 * Verifica un Bearer token jht_sync_... contro cloud_sync_tokens.
 * Aggiorna last_used_at fire-and-forget. Ritorna admin client per la route.
 */
export async function verifyBearerToken(req: NextRequest): Promise<VerifyResult> {
  const authHeader = req.headers.get('authorization') ?? ''
  const match = authHeader.match(BEARER_RE)
  if (!match) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Bearer token mancante o malformato' }, { status: 401 }),
    }
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante' },
        { status: 500 }
      ),
    }
  }

  const hash = hashSyncToken(match[1])
  const { data, error } = await admin
    .from('cloud_sync_tokens')
    .select('id, user_id, name, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) {
    return { ok: false, res: NextResponse.json({ error: error.message }, { status: 500 }) }
  }
  if (!data) {
    return { ok: false, res: NextResponse.json({ error: 'token non valido' }, { status: 401 }) }
  }
  if (data.revoked_at) {
    return { ok: false, res: NextResponse.json({ error: 'token revocato' }, { status: 401 }) }
  }

  await admin
    .from('cloud_sync_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return {
    ok: true,
    data: { userId: data.user_id, tokenId: data.id, name: data.name, admin },
  }
}
