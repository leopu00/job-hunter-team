import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/team-state/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const resolved = await resolveUser(req)
  if (!resolved.ok) return resolved.res
  if (resolved.user.source !== 'token') {
    return NextResponse.json({ error: 'Solo i container con token possono claimare' }, { status: 403 })
  }
  const { userId, token, supabase } = resolved.user

  const { data, error } = await supabase
    .from('team_state')
    .upsert(
      {
        user_id: userId,
        active_device_id: token.tokenId,
        active_device_claimed_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data, claimed_device_id: token.tokenId })
}
