import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'

export const dynamic = 'force-dynamic'

export async function GET() {
  let profile = null

  if (isSupabaseConfigured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const { data } = await supabase
      .from('candidate_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    profile = data
  } else {
    const workspace = await getWorkspacePath()
    if (workspace) profile = readWorkspaceProfile(workspace)
  }

  if (!profile) {
    return NextResponse.json({ error: 'Nessun profilo trovato' }, { status: 404 })
  }

  const date = new Date().toISOString().slice(0, 10)
  const filename = `profilo-candidato-${date}.json`

  return new NextResponse(JSON.stringify(profile, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
