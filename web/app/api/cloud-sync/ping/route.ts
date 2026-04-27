import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { verifyBearerToken } from '@/lib/cloud-sync/auth'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'cloud sync non disponibile' }, { status: 400 })
  }

  const result = await verifyBearerToken(req)
  if (!result.ok) return result.res

  // Ping e' un health-check leggero ma resta auth'd: cap a 60/min per
  // token, sufficiente per polling 1Hz; il limite globale del proxy
  // resta sopra come ulteriore difesa.
  const rl = await checkCloudSyncRateLimit('ping', result.data.tokenId, 60)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit superato. Riprova tra poco.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  return NextResponse.json({
    ok: true,
    user_id: result.data.userId,
    token: { id: result.data.tokenId, name: result.data.name },
  })
}
