import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (isSupabaseConfigured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ profile: null }, { status: 401 })

    const { data } = await supabase
      .from('candidate_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({ profile: data ?? null })
  }

  const workspace = await getWorkspacePath()
  if (!workspace) return NextResponse.json({ profile: null })

  const profile = readWorkspaceProfile(workspace)
  return NextResponse.json({ profile })
}
