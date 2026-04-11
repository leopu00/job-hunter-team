import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { hashSyncToken } from '@/lib/cloud-sync/tokens'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const BEARER_RE = /^Bearer\s+(jht_sync_[A-Za-z0-9_\-]+)$/

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'cloud sync non disponibile' }, { status: 400 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const match = authHeader.match(BEARER_RE)
  if (!match) {
    return NextResponse.json({ error: 'Bearer token mancante o malformato' }, { status: 401 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante' },
      { status: 500 }
    )
  }

  const hash = hashSyncToken(match[1])
  const { data, error } = await admin
    .from('cloud_sync_tokens')
    .select('id, user_id, name, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'token non valido' }, { status: 401 })
  if (data.revoked_at) {
    return NextResponse.json({ error: 'token revocato' }, { status: 401 })
  }

  await admin
    .from('cloud_sync_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return NextResponse.json({
    ok: true,
    user_id: data.user_id,
    token: { id: data.id, name: data.name },
  })
}
