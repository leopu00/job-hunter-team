import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { verifyBearerToken, type VerifiedToken } from '@/lib/cloud-sync/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolvedUser =
  | { source: 'token'; userId: string; token: VerifiedToken; supabase: SupabaseClient }
  | { source: 'session'; userId: string; supabase: SupabaseClient }

export type ResolveResult =
  | { ok: true; user: ResolvedUser }
  | { ok: false; res: NextResponse }

export async function resolveUser(req: NextRequest): Promise<ResolveResult> {
  if (req.headers.get('authorization')) {
    const verified = await verifyBearerToken(req)
    if (!verified.ok) return { ok: false, res: verified.res }
    return {
      ok: true,
      user: {
        source: 'token',
        userId: verified.data.userId,
        token: verified.data,
        supabase: verified.data.admin,
      },
    }
  }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }),
    }
  }
  return {
    ok: true,
    user: { source: 'session', userId: data.user.id, supabase },
  }
}
