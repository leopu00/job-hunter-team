import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import { isLocalRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Richieste dal desktop locale (Electron → http://localhost:3000):
  // servi sempre il profilo dal filesystem, anche se Supabase è
  // configurato nell'env. Senza questo bypass la chat /onboarding
  // riceve 401 e la form a sinistra non si popola mai.
  const useCloudAuth = isSupabaseConfigured && !(await isLocalRequest())

  if (useCloudAuth) {
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

  const profile = readWorkspaceProfile()
  return NextResponse.json({ profile })
}
