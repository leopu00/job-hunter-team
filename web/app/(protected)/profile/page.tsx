import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import { isLocalRequest } from '@/lib/auth'
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

  // In locale (desktop container su localhost) il profilo vive nel
  // workspace YAML, Supabase non viene interpellato — coerente con il
  // bypass auth in (protected)/layout.tsx e proxy.ts.
  if (isSupabaseConfigured && !(await isLocalRequest())) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return (
        <div className="p-12 text-center text-[var(--color-muted)]">
          Session expired. <Link href="/" className="text-[var(--color-green)]">Sign in again</Link>
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
    profile = readWorkspaceProfile()
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
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Profile</span>
        </nav>
        <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              Candidate Profile
            </h1>
            {profile?.updated_at && (
              <p className="text-[var(--color-muted)] text-[11px] mt-1">
                Updated on {new Date(profile.updated_at).toLocaleDateString('it-IT')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/profile/edit"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold no-underline transition-all hover:opacity-90"
              style={{ background: 'var(--color-green)', color: '#000' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </Link>
            {profile && (
              <a
                href="/api/profile/export"
                download
                className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export JSON
              </a>
            )}
          </div>
        </div>
      </div>

      <ProfileStats profile={profile} />

      {!profile && (
        <div className="flex flex-col items-center justify-center py-12 mb-8 text-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-3xl mb-3" style={{ opacity: 0.3 }}>👤</div>
          <p className="text-[13px] text-[var(--color-muted)] font-semibold">No profile configured</p>
          <p className="text-[11px] text-[var(--color-dim)] mt-1 max-w-md">
            Fill out the form below or upload a CV to extract data automatically.
          </p>
        </div>
      )}

      {profile && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Basic Info */}
        <ProfileSection title="Info Base">
          <ProfileField label="Name" value={profile.name} />
          <ProfileField label="Target role" value={profile.target_role} />
          <ProfileField label="Location" value={profile.location} />
          <ProfileField label="Experience" value={profile.experience_years != null ? `${profile.experience_years} years` : null} />
          <ProfileField label="Degree" value={profile.has_degree ? 'Yes' : 'No'} />
          <ProfileField label="Email" value={profile.email} />
        </ProfileSection>

        {/* Contacts */}
        {(profile.email || hasContacts) && (
          <ProfileSection title="Contatti">
            <div className="flex flex-col gap-2.5">
              {profile.email && (
                <ContactRow icon={<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>} label="Email" value={profile.email} href={`mailto:${profile.email}`} />
              )}
              {contacts.phone && (
                <ContactRow icon={<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>} label="Phone" value={contacts.phone} href={`tel:${contacts.phone}`} />
              )}
              {contacts.linkedin && (
                <ContactRow icon={<><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></>} label="LinkedIn" value={contacts.linkedin} href={contacts.linkedin.startsWith('http') ? contacts.linkedin : `https://linkedin.com/in/${contacts.linkedin}`} />
              )}
              {contacts.github && (
                <ContactRow icon={<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>} label="GitHub" value={contacts.github} href={contacts.github.startsWith('http') ? contacts.github : `https://github.com/${contacts.github}`} />
              )}
              {contacts.website && (
                <ContactRow icon={<><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>} label="Website" value={contacts.website} href={contacts.website.startsWith('http') ? contacts.website : `https://${contacts.website}`} />
              )}
            </div>
          </ProfileSection>
        )}

        {/* Languages */}
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
            <span className="text-[var(--color-dim)] text-[11px]">No languages entered</span>
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
            <span className="text-[var(--color-dim)] text-[11px]">No skills entered</span>
          )}
        </ProfileSection>

        {/* Esperienza lavorativa */}
        <ProfileSection title={`Work Experience${hasExperience ? ` (${experience.length})` : ''}`}>
          {hasExperience ? (
            <div className="flex flex-col">
              {experience.map((e, i) => (
                <div key={i} className="flex gap-3">
                  {/* Timeline */}
                  <div className="flex flex-col items-center flex-shrink-0" style={{ width: '16px' }}>
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                      style={{ background: i === 0 ? 'var(--color-green)' : 'var(--color-border)', boxShadow: i === 0 ? '0 0 8px rgba(0,232,122,0.4)' : 'none' }}
                    />
                    {i < experience.length - 1 && (
                      <div className="w-px flex-1 min-h-[16px]" style={{ background: 'var(--color-border)' }} />
                    )}
                  </div>
                  {/* Content */}
                  <div className="pb-4 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-[var(--color-bright)]">{e.role || '—'}</span>
                      {e.period && <span className="text-[10px] text-[var(--color-dim)] flex-shrink-0 font-mono">{e.period}</span>}
                    </div>
                    {e.company && <span className="text-[11px] text-[var(--color-muted)]">{e.company}</span>}
                    {e.description && <p className="text-[10px] text-[var(--color-dim)] mt-1 leading-relaxed">{e.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No experience entered</span>
          )}
        </ProfileSection>

        {/* Formazione */}
        <ProfileSection title={`Education & Certifications${hasEducation ? ` (${education.length + certifications.length})` : ''}`}>
          {hasEducation ? (
            <div className="flex flex-col">
              {education.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center flex-shrink-0" style={{ width: '16px' }}>
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                      style={{ background: i === 0 ? 'var(--color-blue)' : 'var(--color-border)' }}
                    />
                    {(i < education.length - 1 || certifications.length > 0) && (
                      <div className="w-px flex-1 min-h-[16px]" style={{ background: 'var(--color-border)' }} />
                    )}
                  </div>
                  <div className="pb-3 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[12px] text-[var(--color-bright)]">{e.title || '—'}</span>
                        {e.institution && <div className="text-[10px] text-[var(--color-muted)]">{e.institution}</div>}
                      </div>
                      {e.year && <span className="text-[10px] text-[var(--color-dim)] font-mono flex-shrink-0">{e.year}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {certifications.length > 0 && (
                <div className="mt-1">
                  <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-2">Certifications</div>
                  <div className="flex flex-wrap gap-1.5">
                    {certifications.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--color-yellow)]/10 text-[var(--color-yellow)] border border-[var(--color-yellow)]/20">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No education entered</span>
          )}
        </ProfileSection>

        {/* Progetti personali */}
        <ProfileSection title={`Personal Projects${hasProjects ? ` (${projects.length})` : ''}`}>
          {hasProjects ? (
            <div className="flex flex-col gap-2">
              {projects.map((p, i) => (
                <div key={i} className="px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)] transition-colors hover:border-[var(--color-border-glow)]">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0" style={{ color: 'var(--color-purple)' }}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="text-[12px] font-semibold text-[var(--color-bright)] truncate" title={p.name || undefined}>{p.name || '—'}</span>
                    </div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[9px] font-semibold text-[var(--color-blue)] hover:underline no-underline flex-shrink-0"
                      >
                        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        link
                      </a>
                    )}
                  </div>
                  {p.description && <p className="text-[10px] text-[var(--color-dim)] leading-relaxed mt-1 ml-5">{p.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No projects entered</span>
          )}
        </ProfileSection>

        {/* Target Roles */}
        <ProfileSection title={`Ruoli target${profile.job_titles?.length ? ` (${profile.job_titles.length})` : ''}`}>
          {profile.job_titles && profile.job_titles.length > 0 ? (
            <div className="flex flex-col gap-2">
              {profile.job_titles.map((r, i) => (
                <div key={r} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                    style={{
                      background: i === 0 ? 'var(--color-green)' : 'var(--color-border)',
                      color: i === 0 ? '#000' : 'var(--color-dim)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[12px] text-[var(--color-bright)] font-semibold">{r}</span>
                  {i === 0 && <span className="text-[8px] font-bold tracking-[0.15em] uppercase text-[var(--color-green)] ml-auto">TOP</span>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No roles entered</span>
          )}
        </ProfileSection>

        {/* Preferenze lavoro */}
        <ProfileSection title="Job Preferences">
          {profile.location_preferences && profile.location_preferences.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.location_preferences.map((lp, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-green)' }}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <div>
                    <span className="text-[10px] font-semibold text-[var(--color-green)]">
                      {(lp.type ?? '').replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted)] ml-1">
                      {lp.region && lp.region}
                      {lp.cities && lp.cities.join(', ')}
                      {lp.max_days != null && ` (max ${lp.max_days}gg/sett)`}
                      {lp.note && lp.note}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No preferences</span>
          )}
          {profile.salary_target && (profile.salary_target.italy_min != null || profile.salary_target.remote_eu_min != null) && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">Salary target</div>
              <div className="flex flex-col gap-3">
                {profile.salary_target.italy_min != null && (
                  <SalaryRange label="Italia" min={profile.salary_target.italy_min} max={profile.salary_target.italy_max ?? profile.salary_target.italy_min} color="var(--color-green)" />
                )}
                {profile.salary_target.remote_eu_min != null && (
                  <SalaryRange label="Remote EU" min={profile.salary_target.remote_eu_min} max={profile.salary_target.remote_eu_max ?? profile.salary_target.remote_eu_min} color="var(--color-blue)" />
                )}
              </div>
            </div>
          )}
        </ProfileSection>

        {/* Obiettivi di carriera */}
        <ProfileSection title="Career Goals">
          {hasCareerGoals ? (
            <div className="flex flex-col gap-2">
              <ProfileField label="Direction" value={careerGoals.direction || null} />
              <ProfileField label="Target job" value={careerGoals.target_job || null} />
              {(careerGoals.specializations?.length ?? 0) > 0 && (
                <div className="py-1.5 border-b border-[var(--color-border)]">
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">Specializations</div>
                  <div className="flex flex-wrap gap-1.5">
                    {careerGoals.specializations!.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-purple)]/10 text-[var(--color-purple)] border border-[var(--color-purple)]/20 font-semibold">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {(careerGoals.desired_courses?.length ?? 0) > 0 && (
                <div className="py-1.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">Desired courses</div>
                  <div className="flex flex-col gap-1">
                    {careerGoals.desired_courses!.map((c, i) => (
                      <span key={i} className="text-[11px] text-[var(--color-muted)]">· {c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No goals entered</span>
          )}
        </ProfileSection>

        {/* Desideri e aspirazioni */}
        <ProfileSection title="Wishes & Aspirations">
          {hasAspirations ? (
            <div className="flex flex-col gap-2">
              {aspirations.short_term && (
                <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-yellow)' }}>
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-yellow)] mb-0.5">Short term</div>
                    <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">{aspirations.short_term}</p>
                  </div>
                </div>
              )}
              {aspirations.long_term && (
                <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-blue)' }}>
                    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-blue)] mb-0.5">Long term</div>
                    <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">{aspirations.long_term}</p>
                  </div>
                </div>
              )}
              {aspirations.ambitious && (
                <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-green)]/20">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-green)' }}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-green)] mb-0.5">Ambitious aspirations</div>
                    <p className="text-[11px] text-[var(--color-bright)] leading-relaxed italic">{aspirations.ambitious}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-dim)] text-[11px]">No aspirations entered</span>
          )}
        </ProfileSection>

        {/* Strengths */}
        {strengths.length > 0 && (
          <ProfileSection title={`Strengths (${strengths.length})`}>
            <div className="flex flex-wrap gap-2">
              {strengths.map((s, i) => (
                <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-[var(--color-green)]/8 text-[var(--color-green)] border border-[var(--color-green)]/20">
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  {s}
                </span>
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Note libere — full width */}
        {freeNotes && (
          <div className="md:col-span-2">
            <ProfileSection title="Free Notes">
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
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
      <div className="section-label mb-4">{title}</div>
      {children}
    </div>
  )
}

function SalaryRange({ label, min, max, color }: { label: string; min: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-[var(--color-muted)]">{label}</span>
        <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
          €{min.toLocaleString('it-IT')} – €{max.toLocaleString('it-IT')}
        </span>
      </div>
      <div role="progressbar" aria-valuenow={Math.round(Math.min(100, (max / 120000) * 100))} aria-valuemin={0} aria-valuemax={100} aria-label="Salary range" className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-panel)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (max / 120000) * 100)}%`, background: color, opacity: 0.6 }} />
      </div>
    </div>
  )
}

function ContactRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      target={href.startsWith('mailto:') || href.startsWith('tel:') ? undefined : '_blank'}
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)] no-underline transition-colors hover:border-[var(--color-border-glow)]"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
        {icon}
      </svg>
      <div className="flex-1 min-w-0">
        <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] block">{label}</span>
        <span className="text-[11px] text-[var(--color-bright)] truncate block">{value}</span>
      </div>
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0" style={{ color: 'var(--color-dim)' }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </a>
  )
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[rgba(255,255,255,0.015)]">
      <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-[12px] text-[var(--color-bright)] text-right">
        {value ?? <span className="text-[var(--color-dim)]">—</span>}
      </span>
    </div>
  )
}
