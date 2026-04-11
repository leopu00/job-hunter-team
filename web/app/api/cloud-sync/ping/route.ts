import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { verifyBearerToken } from '@/lib/cloud-sync/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'cloud sync non disponibile' }, { status: 400 })
  }

  const result = await verifyBearerToken(req)
  if (!result.ok) return result.res

  return NextResponse.json({
    ok: true,
    user_id: result.data.userId,
    token: { id: result.data.tokenId, name: result.data.name },
  })
}
