import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import type { CandidateProfile } from '@/lib/types'
import ProfilePageClient from '@/components/ProfilePageClient'
import ProfileStats from '@/components/ProfileStats'

const SKILL_CATEGORY_COLORS = [
  'var(--color-blue)',
  'var(--color-green)',
  'var(--color-purple)',
  'var(--color-yellow)',
  'var(--color-orange)',
  '#58a6ff',
  '#f78166',
  '#d2a8ff',
]

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

  const pos = profile?.positioning ?? {}
  const contacts = (pos.contacts ?? {}) as Record<string, string>
  const experience = (pos.experience ?? []) as { role?: string; company?: string; period?: string; description?: string }[]
  const education = (pos.education ?? []) as { title?: string; institution?: string; year?: string | number }[]
  const certifications = (pos.certifications ?? []) as string[]
  const projects = (pos.projects ?? []) as { name?: string; description?: string; url?: string }[]
  const strengths = (pos.strengths ?? []) as string[]
  const careerGoals = (pos.career_goals ?? {}) as { direction?: string; specializations?: string[]; target_job?: string; desired_courses?: string[] }
  const aspirations = (pos.aspirations ?? {}) as { short_term?: string; long_term?: string; ambitious?: string }
  const freeNotes = (pos.free_notes ?? '') as string

  const allSkills: string[] = profile?.skills
    ? Object.values(profile.skills).flat()
    : []

  const hasContacts = contacts.phone || contacts.linkedin || contacts.github || contacts.website
  const hasExperience = experience.length > 0
  const hasEducation = education.length > 0 || certifications.length > 0
  const hasProjects = projects.length > 0
  const hasCareerGoals = careerGoals.direction || (careerGoals.specializations?.length ?? 0) > 0 || careerGoals.target_job || (careerGoals.desired_courses?.length ?? 0) > 0
  const hasAspirations = aspirations.short_term || aspirations.long_term || aspirations.ambitious

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Profilo</span>
        </div>
        <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              Profilo Candidato
            </h1>
            {profile?.updated_at && (
              <p className="text-[var(--color-muted)] text-[11px] mt-1">
                Aggiornato il {new Date(profile.updated_at).toLocaleDateString('it-IT')}
              </p>
            )}
          </div>
          {profile && (
            <a
              href="/api/profile/export"
              download
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Esporta JSON
            </a>
          )}
        </div>
      </div>

      <ProfileStats profile={profile} />

      {!profile && (
        <div className="flex flex-col items-center justify-center py-12 mb-8 text-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-3xl mb-3" style={{ opacity: 0.3 }}>👤</div>
          <p className="text-[13px] text-[var(--color-muted)] font-semibold">Nessun profilo configurato</p>
          <p className="text-[11px] text-[var(--color-dim)] mt-1 max-w-md">
            Compila il form qui sotto oppure carica un CV per estrarre i dati automaticamente.
          </p>
        </div>
      )}

      {profile && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Info Base */}
        <ProfileSection title="Info Base">
          <ProfileField label="Nome" value={profile.name} />
          <ProfileField label="Ruolo target" value={profile.target_role} />
          <ProfileField label="Location" value={profile.location} />
          <ProfileField label="Esperienza" value={profile.experience_years != null ? `${profile.experience_years} anni` : null} />
          <ProfileField label="Laurea" value={profile.has_degree ? 'Sì' : 'No'} />
          <ProfileField label="Email" value={profile.email} />
        </ProfileSection>

        {/* Contatti */}
        {(profile.email || hasContacts) && (
          <ProfileSection title="Contatti">
            <ProfileField label="Email" value={profile.email} />
            <ProfileField label="Telefono" value={contacts.phone || null} />
            <ProfileField label="LinkedIn" value={contacts.linkedin || null} />
            <ProfileField label="GitHub" value={contacts.github || null} />
            <ProfileField label="Website" value={contacts.website || null} />
          </ProfileSection>
        )}

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

        {/* Skills */}
        <ProfileSection title={`Skills${allSkills.length > 0 ? ` (${allSkills.length})` : ''}`}>
          {allSkills.length > 0 ? (
            <div className="flex flex-col gap-3">
              {Object.entries(profile.skills!).map(([category, items], catIdx) => {
                const color = SKILL_CATEGORY_COLORS[catIdx % SKILL_CATEGORY_COLORS.length]
                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)]">
                        {category.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[9px] text-[var(--color-dim)]">({(items as string[]).length})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(items as string[]).map(s => (
                        <span key={s} className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded" style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna skill inserita</span>
          )}
        </ProfileSection>

        {/* Esperienza lavorativa */}
        <ProfileSection title="Esperienza Lavorativa">
          {hasExperience ? (
            <div className="flex flex-col gap-4">
              {experience.map((e, i) => (
                <div key={i} className="pb-3 border-b border-[var(--color-border)] last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-[12px] font-semibold text-[var(--color-bright)]">{e.role || '—'}</span>
                    {e.period && <span className="text-[10px] text-[var(--color-dim)] flex-shrink-0 font-mono">{e.period}</span>}
                  </div>
                  {e.company && <span className="text-[11px] text-[var(--color-muted)]">{e.company}</span>}
                  {e.description && <p className="text-[10px] text-[var(--color-dim)] mt-1 leading-relaxed">{e.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna esperienza inserita</span>
          )}
        </ProfileSection>

        {/* Formazione */}
        <ProfileSection title="Formazione & Certificazioni">
          {hasEducation ? (
            <div className="flex flex-col gap-3">
              {education.map((e, i) => (
                <div key={i} className="flex items-start justify-between gap-2 pb-2 border-b border-[var(--color-border)] last:border-0 last:pb-0">
                  <div>
                    <span className="text-[12px] text-[var(--color-bright)]">{e.title || '—'}</span>
                    {e.institution && <div className="text-[10px] text-[var(--color-muted)]">{e.institution}</div>}
                  </div>
                  {e.year && <span className="text-[10px] text-[var(--color-dim)] font-mono flex-shrink-0">{e.year}</span>}
                </div>
              ))}
              {certifications.length > 0 && (
                <div className="mt-2">
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-2">Certificazioni</div>
                  <div className="flex flex-wrap gap-1.5">
                    {certifications.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--color-yellow)]/10 text-[var(--color-yellow)] border border-[var(--color-yellow)]/20">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna formazione inserita</span>
          )}
        </ProfileSection>

        {/* Progetti personali */}
        <ProfileSection title="Progetti Personali">
          {hasProjects ? (
            <div className="flex flex-col gap-3">
              {projects.map((p, i) => (
                <div key={i} className="pb-2 border-b border-[var(--color-border)] last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold text-[var(--color-bright)]">{p.name || '—'}</span>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[var(--color-blue)] hover:underline font-mono flex-shrink-0">link</a>
                    )}
                  </div>
                  {p.description && <p className="text-[10px] text-[var(--color-dim)] leading-relaxed">{p.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessun progetto inserito</span>
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

        {/* Preferenze lavoro */}
        <ProfileSection title="Preferenze Lavoro">
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
          {profile.salary_target && (profile.salary_target.italy_min != null || profile.salary_target.remote_eu_min != null) && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-2">Salary target</div>
              {profile.salary_target.italy_min != null && (
                <ProfileField label="Italia" value={`€${profile.salary_target.italy_min.toLocaleString()}–${(profile.salary_target.italy_max ?? profile.salary_target.italy_min).toLocaleString()}`} />
              )}
              {profile.salary_target.remote_eu_min != null && (
                <ProfileField label="Remote EU" value={`€${profile.salary_target.remote_eu_min.toLocaleString()}–${(profile.salary_target.remote_eu_max ?? profile.salary_target.remote_eu_min).toLocaleString()}`} />
              )}
            </div>
          )}
        </ProfileSection>

        {/* Obiettivi di carriera */}
        <ProfileSection title="Obiettivi di Carriera">
          {hasCareerGoals ? (
            <div className="flex flex-col gap-2">
              <ProfileField label="Direzione" value={careerGoals.direction || null} />
              <ProfileField label="Job target" value={careerGoals.target_job || null} />
              {(careerGoals.specializations?.length ?? 0) > 0 && (
                <div className="py-1.5 border-b border-[var(--color-border)]">
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">Specializzazioni</div>
                  <div className="flex flex-wrap gap-1.5">
                    {careerGoals.specializations!.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-purple)]/10 text-[var(--color-purple)] border border-[var(--color-purple)]/20 font-semibold">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {(careerGoals.desired_courses?.length ?? 0) > 0 && (
                <div className="py-1.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">Corsi desiderati</div>
                  <div className="flex flex-col gap-1">
                    {careerGoals.desired_courses!.map((c, i) => (
                      <span key={i} className="text-[11px] text-[var(--color-muted)]">· {c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessun obiettivo inserito</span>
          )}
        </ProfileSection>

        {/* Desideri e aspirazioni */}
        <ProfileSection title="Desideri & Aspirazioni">
          {hasAspirations ? (
            <div className="flex flex-col gap-3">
              {aspirations.short_term && (
                <div>
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-1">Breve termine</div>
                  <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">{aspirations.short_term}</p>
                </div>
              )}
              {aspirations.long_term && (
                <div>
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-1">Lungo termine</div>
                  <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">{aspirations.long_term}</p>
                </div>
              )}
              {aspirations.ambitious && (
                <div>
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-1">Aspirazioni ambiziose</div>
                  <p className="text-[11px] text-[var(--color-bright)] leading-relaxed italic">{aspirations.ambitious}</p>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">Nessuna aspirazione inserita</span>
          )}
        </ProfileSection>

        {/* Strengths */}
        {strengths.length > 0 && (
          <ProfileSection title="Punti di forza">
            <div className="flex flex-wrap gap-1.5">
              {strengths.map((s, i) => (
                <span key={i} className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--color-green)]/10 text-[var(--color-green)] border border-[var(--color-green)]/20">{s}</span>
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Note libere — full width */}
        {freeNotes && (
          <div className="md:col-span-2">
            <ProfileSection title="Note Libere">
              <p className="text-[12px] text-[var(--color-bright)] leading-relaxed whitespace-pre-wrap">{freeNotes}</p>
            </ProfileSection>
          </div>
        )}

      </div>
      )}

      <ProfilePageClient profile={profile} />
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
      <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-[12px] text-[var(--color-bright)] text-right">
        {value ?? <span className="text-[var(--color-dim)]">—</span>}
      </span>
    </div>
  )
}
