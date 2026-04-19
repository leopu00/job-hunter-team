import fs from 'fs'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import { isLocalRequest } from '@/lib/auth'
import { JHT_PROFILE_READY_FLAG } from '@/lib/jht-paths'

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
    if (!user) return NextResponse.json({ profile: null, ready: false }, { status: 401 })

    const { data } = await supabase
      .from('candidate_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({ profile: data ?? null, ready: false })
  }

  const profile = readWorkspaceProfile()
  // Il bottone "Vai alla dashboard" viene abilitato ESCLUSIVAMENTE quando
  // l'assistente crea ~/.jht/profile/ready.flag (nessuna euristica lato
  // frontend). Così la decisione di sbloccare resta agli occhi dell'agente
  // che sa cosa ha raccolto e se è abbastanza per partire.
  const ready = fs.existsSync(JHT_PROFILE_READY_FLAG)
  return NextResponse.json({ profile, ready })
}
