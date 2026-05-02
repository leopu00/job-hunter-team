import { NextResponse } from 'next/server'
import { loadLocalCloudConfig } from '@/lib/cloud-sync/local'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = await loadLocalCloudConfig()
  if (!config) {
    return NextResponse.json({ local: false, enabled: false })
  }
  return NextResponse.json({
    local: true,
    enabled: true,
    base_url: config.base_url,
    token_name: config.token_name,
    user_id: config.user_id,
  })
}
