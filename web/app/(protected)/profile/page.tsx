import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readProfile } from '@/lib/profile-reader'
import type { CandidateProfile } from '@/lib/types'

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
      profile = readProfile(workspace)
    }
  }

  if (!profile) {
    return (
      <div style={{ animation: 'fade-in 0.35s ease both' }}>
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            Profilo Candidato
          </h1>
        </div>
        <div className="border border-dashed border-[var(--color-border)] rounded-lg p-12 text-center max-w-md mx-auto mt-16">
          <div className="text-[var(--color-dim)] text-4xl mb-4 font-mono">[ ]</div>
          <p className="text-[var(--color-muted)] text-sm mb-2">
            Nessun profilo configurato
          </p>
          <p className="text-[var(--color-dim)] text-[11px] mb-6">
            Compila il tuo profilo candidato per permettere al team di agenti
            di personalizzare CV e cover letter.
          </p>
          <Link
            href="/profile/edit"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-green)] text-[var(--color-void)] text-[11px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity no-underline"
          >
            + Crea profilo
          </Link>
        </div>
      </div>
    )
  }

  // Flatten skills object into tag list
  const allSkills: string[] = profile.skills
    ? Object.values(profile.skills).flat()
    : []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)] flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            Profilo Candidato
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            {profile.updated_at ? `Aggiornato il ${new Date(profile.updated_at).toLocaleDateString('it-IT')}` : 'Profilo attivo'}
          </p>
        </div>
        <Link
          href="/profile/edit"
          className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border)] rounded text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors no-underline"
        >
          Modifica
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Info base */}
        <ProfileSection title="Info Base">
          <ProfileField label="Nome" value={profile.name} />
          <ProfileField label="Ruolo target" value={profile.target_role} />
          <ProfileField label="Location" value={profile.location} />
          <ProfileField label="Esperienza" value={profile.experience_years != null ? `${profile.experience_years} anni (${profile.experience_months ?? 0} mesi)` : null} />
          <ProfileField label="Laurea" value={profile.has_degree ? 'Sì' : 'No'} />
          <ProfileField label="Email" value={profile.email} />
        </ProfileSection>

        {/* Lingue */}
        <ProfileSection title="Lingue">
          {profile.languages && profile.languages.length > 0 ? (
            <div className="flex flex-col gap-2">
              {profile.languages.map(l => (
                <div key={l.language} className="flex items-center justify-between">
                  <span className="text-[var(--color-bright)] text-[12px]">{l.language}</span>
                  <span className="text-[10px] text-[var(--color-muted)] bg-[var(--color-panel)] border border-[var(--color-border)] px-2 py-0.5 rounded">{l.level}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna lingua inserita</span>
          )}
        </ProfileSection>

        {/* Skills per categoria */}
        <ProfileSection title="Skills">
          {allSkills.length > 0 ? (
            <div className="flex flex-col gap-3">
              {Object.entries(profile.skills!).map(([category, items]) => (
                <div key={category}>
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-1.5">
                    {category.replace(/_/g, ' ')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(items as string[]).map(s => (
                      <span
                        key={s}
                        className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded bg-[var(--color-blue)]/10 text-[var(--color-blue)] border border-[var(--color-blue)]/20"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna skill inserita</span>
          )}
        </ProfileSection>

        {/* Location preferences */}
        <ProfileSection title="Location preferite">
          {profile.location_preferences && profile.location_preferences.length > 0 ? (
            <div className="flex flex-col gap-2">
              {profile.location_preferences.map((lp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded bg-[var(--color-green)]/10 text-[var(--color-green)] border border-[var(--color-green)]/20">
                    {(lp.type ?? '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {lp.region && lp.region}
                    {lp.cities && lp.cities.join(', ')}
                    {lp.max_days != null && ` (max ${lp.max_days}gg/sett)`}
                    {lp.note && lp.note}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna preferenza</span>
          )}
        </ProfileSection>

        {/* Ruoli target */}
        <ProfileSection title="Ruoli target">
          {profile.job_titles && profile.job_titles.length > 0 ? (
            <ol className="flex flex-col gap-1.5">
              {profile.job_titles.map((r, i) => (
                <li key={r} className="flex items-center gap-2 text-[12px]">
                  <span className="text-[10px] text-[var(--color-dim)] w-4 text-right">{i + 1}.</span>
                  <span className="text-[var(--color-bright)]">{r}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessun ruolo inserito</span>
          )}
        </ProfileSection>

        {/* Salary target */}
        {profile.salary_target && (profile.salary_target.italy_min != null || profile.salary_target.remote_eu_min != null) && (
          <ProfileSection title="Salary target">
            {profile.salary_target.italy_min != null && (
              <ProfileField label="Italia" value={`€${profile.salary_target.italy_min.toLocaleString()}–${(profile.salary_target.italy_max ?? profile.salary_target.italy_min).toLocaleString()}`} />
            )}
            {profile.salary_target.remote_eu_min != null && (
              <ProfileField label="Remote EU" value={`€${profile.salary_target.remote_eu_min.toLocaleString()}–${(profile.salary_target.remote_eu_max ?? profile.salary_target.remote_eu_min).toLocaleString()}`} />
            )}
          </ProfileSection>
        )}

      </div>
    </div>
  )
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
      <div className="section-label mb-4">{title}</div>
      {children}
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-0">
      <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-[12px] text-[var(--color-bright)] text-right">
        {value ?? <span className="text-[var(--color-dim)]">—</span>}
      </span>
    </div>
  )
}
