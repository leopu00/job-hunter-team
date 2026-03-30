import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import type { CandidateProfile } from '@/lib/types'
import ProfilePageClient from '@/components/ProfilePageClient'
import ProfileAssistant from '@/components/ProfileAssistant'

export default async function ProfilePage() {
  let profile: CandidateProfile | null = null

  if (isSupabaseConfigured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return (
        <div className="p-12 text-center text-[var(--color-muted)]">
          Sessione scaduta. <a href="/" className="text-[var(--color-green)]">Accedi di nuovo</a>
        </div>
      )
    }
    const { data } = await supabase
      .from('candidate_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single() as { data: CandidateProfile | null }
    profile = data
  } else {
    const workspace = await getWorkspacePath()
    if (workspace) {
      profile = readWorkspaceProfile(workspace)
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          Profilo Candidato
        </h1>
        {profile?.updated_at && (
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Aggiornato il {new Date(profile.updated_at).toLocaleDateString('it-IT')}
          </p>
        )}
      </div>

      <ProfilePageClient profile={profile} />
      <ProfileAssistant profile={profile} />
    </div>
  )
}
