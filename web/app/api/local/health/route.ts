import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { localDbExists } from '@/lib/cloud-sync/local'

export const dynamic = 'force-dynamic'

export async function GET() {
  const local = await localDbExists()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return NextResponse.json({
    local,
    logged_in: !!user,
    user_email: user?.email ?? null,
    user_id: user?.id ?? null,
  })
}
