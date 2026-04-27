import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { generateSyncToken } from '@/lib/cloud-sync/tokens'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

const NOT_CLOUD = NextResponse.json(
  { error: 'Cloud sync disponibile solo in modalità cloud' },
  { status: 400 }
)
const UNAUTH = NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

// Tokens lifecycle (list/create/revoke) e' raro per design: 10/min
// per user e' largo per UI normale ma cappa abuso (es. enumeration).
const TOKENS_LIMIT_PER_MIN = 10

function rateLimitedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'Rate limit superato. Riprova tra poco.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(TOKENS_LIMIT_PER_MIN),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}

export async function GET() {
  if (!isSupabaseConfigured) return NOT_CLOUD
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return UNAUTH

  const rl = await checkCloudSyncRateLimit('tokens-get', user.id, TOKENS_LIMIT_PER_MIN)
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec)

  const { data, error } = await supabase
    .from('cloud_sync_tokens')
    .select('id, name, token_prefix, last_used_at, created_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tokens: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return UNAUTH

  const rl = await checkCloudSyncRateLimit('tokens-post', user.id, TOKENS_LIMIT_PER_MIN)
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec)

  let body: { name?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  const name = body.name?.trim() ?? ''
  if (name.length < 1 || name.length > 100) {
    return NextResponse.json({ error: 'Nome obbligatorio (1-100 caratteri)' }, { status: 400 })
  }

  const { token, prefix, hash } = generateSyncToken()
  const { data, error } = await supabase
    .from('cloud_sync_tokens')
    .insert({ user_id: user.id, name, token_prefix: prefix, token_hash: hash })
    .select('id, name, token_prefix, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ...data, token }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return UNAUTH

  const rl = await checkCloudSyncRateLimit('tokens-delete', user.id, TOKENS_LIMIT_PER_MIN)
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  const { error } = await supabase
    .from('cloud_sync_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
