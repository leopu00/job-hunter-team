import fs from 'fs'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { isProfileComplete, readWorkspaceProfile } from '@/lib/profile-reader'
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
  // Il bottone "Vai alla dashboard" si abilita se uno dei due è vero:
  //   (a) l'assistente ha creato ~/.jht/profile/ready.flag (canale esplicito).
  //   (b) il YAML soddisfa già la checklist minima (nome, ruolo, città,
  //       anni, email, ≥2 skill, ≥1 lingua, ≥1 esperienza, ≥1 titolo).
  // Il fallback (b) evita il bug classico in cui l'assistente annuncia in
  // chat "ho sbloccato" senza aver effettivamente eseguito il comando shell
  // che crea il flag: con la checklist completa, da qui `ready` è già true
  // e l'utente non resta bloccato per un'allucinazione del modello.
  const ready = fs.existsSync(JHT_PROFILE_READY_FLAG) || isProfileComplete(profile)
  return NextResponse.json({ profile, ready })
}
