'use client'

import { useState, useEffect, useTransition, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CandidateProfile, Language } from '@/lib/types'

type UploadedFile = { name: string; size: number; modified: number }

type Experience = { role: string; company: string; period: string; description: string }
type Education = { title: string; institution: string; year: string }
type Project = { name: string; description: string; url: string }
type CareerGoals = { direction: string; target_job: string; specializations: string[]; desired_courses: string[] }
type Aspirations = { short_term: string; long_term: string; ambitious: string }

type FormData = {
  name: string
  target_role: string
  location: string
  experience_years: string
  has_degree: boolean
  email: string
  phone: string
  linkedin: string
  github: string
  website: string
  skills_raw: string
  location_preferences_raw: string
  job_titles_raw: string
  certifications_raw: string
  strengths_raw: string
  free_notes: string
  // career goals
  cg_direction: string
  cg_target_job: string
  cg_specializations_raw: string
  cg_desired_courses_raw: string
  // aspirations
  asp_short_term: string
  asp_long_term: string
  asp_ambitious: string
  // salary
  salary_italy_min: string
  salary_italy_max: string
  salary_remote_eu_min: string
  salary_remote_eu_max: string
  // lang temp
  lang_language: string
  lang_level: string
  // experience temp
  exp_role: string
  exp_company: string
  exp_period: string
  exp_description: string
  // education temp
  edu_title: string
  edu_institution: string
  edu_year: string
  // project temp
  proj_name: string
  proj_description: string
  proj_url: string
}

const INITIAL: FormData = {
  name: '', target_role: '', location: '', experience_years: '',
  has_degree: false, email: '',
  phone: '', linkedin: '', github: '', website: '',
  skills_raw: '', location_preferences_raw: '', job_titles_raw: '',
  certifications_raw: '', strengths_raw: '', free_notes: '',
  cg_direction: '', cg_target_job: '', cg_specializations_raw: '', cg_desired_courses_raw: '',
  asp_short_term: '', asp_long_term: '', asp_ambitious: '',
  salary_italy_min: '', salary_italy_max: '', salary_remote_eu_min: '', salary_remote_eu_max: '',
  lang_language: '', lang_level: '',
  exp_role: '', exp_company: '', exp_period: '', exp_description: '',
  edu_title: '', edu_institution: '', edu_year: '',
  proj_name: '', proj_description: '', proj_url: '',
}

export default function ProfileEditPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<FormData>(INITIAL)
  const [languages, setLanguages] = useState<Language[]>([])
  const [experience, setExperience] = useState<Experience[]>([])
  const [education, setEducation] = useState<Education[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/profile')
        const data = await res.json()
        const profile: CandidateProfile | null = data.profile
        if (profile) {
          const pos = profile.positioning ?? {}
          const contacts = (pos.contacts ?? {}) as Record<string, string>
          const careerGoals = (pos.career_goals ?? {}) as CareerGoals
          const aspirations = (pos.aspirations ?? {}) as Aspirations
          const salary = profile.salary_target

          setForm({
            name: profile.name ?? '',
            target_role: profile.target_role ?? '',
            location: profile.location ?? '',
            experience_years: profile.experience_years != null ? String(profile.experience_years) : '',
            has_degree: profile.has_degree,
            email: profile.email ?? '',
            phone: contacts.phone ?? '',
            linkedin: contacts.linkedin ?? '',
            github: contacts.github ?? '',
            website: contacts.website ?? '',
            skills_raw: profile.skills ? Object.values(profile.skills).flat().join(', ') : '',
            location_preferences_raw: profile.location_preferences
              ? profile.location_preferences.map(lp => {
                  const parts = [(lp.type ?? '').replace(/_/g, ' ')]
                  if (lp.region) parts.push(lp.region)
                  if (lp.cities) parts.push(lp.cities.join('/'))
                  return parts.filter(Boolean).join(' ')
                }).join(', ')
              : '',
            job_titles_raw: (profile.job_titles ?? []).join('\n'),
            certifications_raw: ((pos.certifications ?? []) as string[]).join('\n'),
            strengths_raw: ((pos.strengths ?? []) as string[]).join('\n'),
            free_notes: (pos.free_notes ?? '') as string,
            cg_direction: careerGoals.direction ?? '',
            cg_target_job: careerGoals.target_job ?? '',
            cg_specializations_raw: (careerGoals.specializations ?? []).join('\n'),
            cg_desired_courses_raw: (careerGoals.desired_courses ?? []).join('\n'),
            asp_short_term: aspirations.short_term ?? '',
            asp_long_term: aspirations.long_term ?? '',
            asp_ambitious: aspirations.ambitious ?? '',
            salary_italy_min: salary?.italy_min != null ? String(salary.italy_min) : '',
            salary_italy_max: salary?.italy_max != null ? String(salary.italy_max) : '',
            salary_remote_eu_min: salary?.remote_eu_min != null ? String(salary.remote_eu_min) : '',
            salary_remote_eu_max: salary?.remote_eu_max != null ? String(salary.remote_eu_max) : '',
            lang_language: '', lang_level: '',
            exp_role: '', exp_company: '', exp_period: '', exp_description: '',
            edu_title: '', edu_institution: '', edu_year: '',
            proj_name: '', proj_description: '', proj_url: '',
          })
          setLanguages(profile.languages ?? [])
          setExperience(((pos.experience ?? []) as Experience[]).map(e => ({
            role: e.role ?? '', company: e.company ?? '',
            period: e.period ?? '', description: e.description ?? '',
          })))
          setEducation(((pos.education ?? []) as Education[]).map(e => ({
            title: e.title ?? '', institution: e.institution ?? '', year: e.year != null ? String(e.year) : '',
          })))
          setProjects(((pos.projects ?? []) as Project[]).map(p => ({
            name: p.name ?? '', description: p.description ?? '', url: p.url ?? '',
          })))
        }
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
    loadFiles()
  }, [])

  const loadFiles = async () => {
    try {
      const res = await fetch('/api/profile/files')
      const data = await res.json()
      setUploadedFiles(data.files ?? [])
    } catch { /* ignore */ }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    setUploadError(null)
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    try {
      const res = await fetch('/api/profile/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.errors?.length) setUploadError(data.errors.join(', '))
      await loadFiles()
    } catch {
      setUploadError('Errore durante l\'upload')
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDeleteFile = async (name: string) => {
    try {
      await fetch('/api/profile/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      await loadFiles()
    } catch { /* ignore */ }
  }

  const set = (key: keyof FormData, value: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const addLanguage = () => {
    if (!form.lang_language.trim()) return
    setLanguages(prev => [...prev, { language: form.lang_language.trim(), level: form.lang_level || 'n/a' }])
    setForm(prev => ({ ...prev, lang_language: '', lang_level: '' }))
  }

  const addExperience = () => {
    if (!form.exp_role.trim()) return
    setExperience(prev => [...prev, {
      role: form.exp_role.trim(), company: form.exp_company.trim(),
      period: form.exp_period.trim(), description: form.exp_description.trim(),
    }])
    setForm(prev => ({ ...prev, exp_role: '', exp_company: '', exp_period: '', exp_description: '' }))
  }

  const addEducation = () => {
    if (!form.edu_title.trim()) return
    setEducation(prev => [...prev, {
      title: form.edu_title.trim(), institution: form.edu_institution.trim(), year: form.edu_year.trim(),
    }])
    setForm(prev => ({ ...prev, edu_title: '', edu_institution: '', edu_year: '' }))
  }

  const addProject = () => {
    if (!form.proj_name.trim()) return
    setProjects(prev => [...prev, {
      name: form.proj_name.trim(), description: form.proj_description.trim(), url: form.proj_url.trim(),
    }])
    setForm(prev => ({ ...prev, proj_name: '', proj_description: '', proj_url: '' }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const skillsList = form.skills_raw.split(',').map(s => s.trim()).filter(Boolean)
      const certifications = form.certifications_raw.split('\n').map(s => s.trim()).filter(Boolean)
      const strengths = form.strengths_raw.split('\n').map(s => s.trim()).filter(Boolean)
      const careerGoals: CareerGoals = {
        direction: form.cg_direction.trim(),
        target_job: form.cg_target_job.trim(),
        specializations: form.cg_specializations_raw.split('\n').map(s => s.trim()).filter(Boolean),
        desired_courses: form.cg_desired_courses_raw.split('\n').map(s => s.trim()).filter(Boolean),
      }
      const aspirations: Aspirations = {
        short_term: form.asp_short_term.trim(),
        long_term: form.asp_long_term.trim(),
        ambitious: form.asp_ambitious.trim(),
      }

      const salaryPayload = (form.salary_italy_min || form.salary_remote_eu_min)
        ? {
            currency: 'EUR',
            italy_min: form.salary_italy_min ? parseInt(form.salary_italy_min) : 0,
            italy_max: form.salary_italy_max ? parseInt(form.salary_italy_max) : 0,
            remote_eu_min: form.salary_remote_eu_min ? parseInt(form.salary_remote_eu_min) : 0,
            remote_eu_max: form.salary_remote_eu_max ? parseInt(form.salary_remote_eu_max) : 0,
          }
        : null

      const payload = {
        name: form.name || null,
        email: form.email || null,
        target_role: form.target_role || null,
        location: form.location || null,
        experience_years: form.experience_years ? parseInt(form.experience_years) : null,
        has_degree: form.has_degree,
        skills: skillsList.length > 0 ? { general: skillsList } : {},
        languages,
        location_preferences: form.location_preferences_raw.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ type: s })),
        job_titles: form.job_titles_raw.split('\n').map(s => s.trim()).filter(Boolean),
        salary_target: salaryPayload,
        positioning: {
          contacts: {
            email: form.email || '',
            phone: form.phone || '',
            linkedin: form.linkedin || '',
            github: form.github || '',
            website: form.website || '',
          },
          experience,
          education,
          certifications,
          projects,
          strengths,
          career_goals: careerGoals,
          aspirations,
          free_notes: form.free_notes.trim(),
        },
        updated_at: new Date().toISOString(),
      }

      try {
        const res = await fetch('/api/profile-assistant/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: payload, confirmed: true }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          setError(data.error ?? 'Errore durante il salvataggio')
        } else {
          setSuccess(true)
          setTimeout(() => router.push('/profile'), 800)
        }
      } catch {
        setError('Errore di rete')
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-[var(--color-dim)] text-[11px] tracking-widest uppercase animate-pulse">
          Caricamento...
        </span>
      </div>
    )
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link href="/profile" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Profilo</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Modifica</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Modifica Profilo</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          Questi dati vengono usati dagli agenti per personalizzare CV e cover letter
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">

        {/* ── Info Base ── */}
        <FormSection title="Info Base">
          <FormRow>
            <FormField label="Nome completo">
              <input type="text" value={form.name} placeholder="Es. Mario Rossi"
                onChange={e => set('name', e.target.value)} />
            </FormField>
            <FormField label="Ruolo target principale">
              <input type="text" value={form.target_role} placeholder="Es. Backend Developer"
                onChange={e => set('target_role', e.target.value)} />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Location">
              <input type="text" value={form.location} placeholder="Es. Remote EU"
                onChange={e => set('location', e.target.value)} />
            </FormField>
            <FormField label="Anni di esperienza">
              <input type="number" min="0" max="40" value={form.experience_years}
                placeholder="Es. 3" onChange={e => set('experience_years', e.target.value)} />
            </FormField>
          </FormRow>
          <div className="flex items-center gap-3 mt-2">
            <input type="checkbox" id="degree" checked={form.has_degree}
              onChange={e => set('has_degree', e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-[var(--color-green)]"
              style={{ width: '16px', padding: 0 }} />
            <label htmlFor="degree" className="text-[11px] text-[var(--color-base)] cursor-pointer mb-0 normal-case tracking-normal font-normal">
              Ho una laurea (triennale o magistrale)
            </label>
          </div>
        </FormSection>

        {/* ── Contatti ── */}
        <FormSection title="Contatti">
          <FormRow>
            <FormField label="Email">
              <input type="email" value={form.email} placeholder="nome@example.com"
                onChange={e => set('email', e.target.value)} />
            </FormField>
            <FormField label="Telefono">
              <input type="tel" value={form.phone} placeholder="+39 333 1234567"
                onChange={e => set('phone', e.target.value)} />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="LinkedIn">
              <input type="text" value={form.linkedin} placeholder="linkedin.com/in/..."
                onChange={e => set('linkedin', e.target.value)} />
            </FormField>
            <FormField label="GitHub">
              <input type="text" value={form.github} placeholder="github.com/..."
                onChange={e => set('github', e.target.value)} />
            </FormField>
          </FormRow>
          <FormField label="Website">
            <input type="url" value={form.website} placeholder="https://..."
              onChange={e => set('website', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Skills ── */}
        <FormSection title="Skills">
          <FormField label="Skills (separate da virgola)">
            <textarea rows={3} value={form.skills_raw}
              placeholder="Python, JavaScript, FastAPI, PostgreSQL, Docker, Git"
              onChange={e => set('skills_raw', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Lingue ── */}
        <FormSection title="Lingue">
          {languages.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              {languages.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded">
                  <span className="text-[12px] text-[var(--color-bright)]">{l.language}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--color-muted)]">{l.level}</span>
                    <button type="button" onClick={() => setLanguages(prev => prev.filter((_, j) => j !== i))}
                      className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0">
                      × rimuovi
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <FormRow>
            <FormField label="Lingua">
              <input type="text" value={form.lang_language} placeholder="Es. inglese"
                onChange={e => set('lang_language', e.target.value)} />
            </FormField>
            <FormField label="Livello">
              <select value={form.lang_level} onChange={e => set('lang_level', e.target.value)}>
                <option value="">— seleziona —</option>
                {['madrelingua', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </FormField>
          </FormRow>
          <button type="button" onClick={addLanguage} disabled={!form.lang_language.trim()}
            className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed">
            + Aggiungi lingua
          </button>
        </FormSection>

        {/* ── Esperienza ── */}
        <FormSection title="Esperienza Lavorativa">
          {experience.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {experience.map((e, i) => (
                <div key={i} className="px-3 py-2.5 bg-[var(--color-deep)] border border-[var(--color-border)] rounded">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[12px] font-semibold text-[var(--color-bright)]">{e.role}</span>
                      {e.company && <span className="text-[10px] text-[var(--color-muted)] ml-2">{e.company}</span>}
                      {e.period && <span className="text-[10px] text-[var(--color-dim)] ml-2 font-mono">{e.period}</span>}
                    </div>
                    <button type="button" onClick={() => setExperience(prev => prev.filter((_, j) => j !== i))}
                      className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0 flex-shrink-0">
                      × rimuovi
                    </button>
                  </div>
                  {e.description && <p className="text-[10px] text-[var(--color-dim)] mt-1">{e.description}</p>}
                </div>
              ))}
            </div>
          )}
          <FormRow>
            <FormField label="Ruolo">
              <input type="text" value={form.exp_role} placeholder="Es. Backend Developer"
                onChange={e => set('exp_role', e.target.value)} />
            </FormField>
            <FormField label="Azienda">
              <input type="text" value={form.exp_company} placeholder="Es. Acme S.r.l."
                onChange={e => set('exp_company', e.target.value)} />
            </FormField>
          </FormRow>
          <FormField label="Periodo">
            <input type="text" value={form.exp_period} placeholder="Es. 2022–2024"
              onChange={e => set('exp_period', e.target.value)} />
          </FormField>
          <FormField label="Descrizione (opzionale)">
            <textarea rows={2} value={form.exp_description}
              placeholder="Breve descrizione delle responsabilità"
              onChange={e => set('exp_description', e.target.value)} />
          </FormField>
          <button type="button" onClick={addExperience} disabled={!form.exp_role.trim()}
            className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed">
            + Aggiungi esperienza
          </button>
        </FormSection>

        {/* ── Formazione ── */}
        <FormSection title="Formazione">
          {education.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {education.map((e, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded">
                  <div>
                    <span className="text-[12px] text-[var(--color-bright)]">{e.title}</span>
                    {e.institution && <span className="text-[10px] text-[var(--color-muted)] ml-2">{e.institution}</span>}
                    {e.year && <span className="text-[10px] text-[var(--color-dim)] ml-2 font-mono">{e.year}</span>}
                  </div>
                  <button type="button" onClick={() => setEducation(prev => prev.filter((_, j) => j !== i))}
                    className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0">
                    × rimuovi
                  </button>
                </div>
              ))}
            </div>
          )}
          <FormRow>
            <FormField label="Titolo">
              <input type="text" value={form.edu_title} placeholder="Es. Laurea in Informatica"
                onChange={e => set('edu_title', e.target.value)} />
            </FormField>
            <FormField label="Istituto">
              <input type="text" value={form.edu_institution} placeholder="Es. Università di Bologna"
                onChange={e => set('edu_institution', e.target.value)} />
            </FormField>
          </FormRow>
          <FormField label="Anno">
            <input type="text" value={form.edu_year} placeholder="Es. 2020"
              onChange={e => set('edu_year', e.target.value)} />
          </FormField>
          <button type="button" onClick={addEducation} disabled={!form.edu_title.trim()}
            className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed">
            + Aggiungi titolo
          </button>
          <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
            <FormField label="Certificazioni (una per riga)">
              <textarea rows={3} value={form.certifications_raw}
                placeholder={'AWS Solutions Architect\nGoogle Cloud Professional\nKubernetes Administrator'}
                onChange={e => set('certifications_raw', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        {/* ── Progetti ── */}
        <FormSection title="Progetti Personali">
          {projects.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {projects.map((p, i) => (
                <div key={i} className="px-3 py-2.5 bg-[var(--color-deep)] border border-[var(--color-border)] rounded">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[var(--color-bright)]">{p.name}</span>
                    <button type="button" onClick={() => setProjects(prev => prev.filter((_, j) => j !== i))}
                      className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0 flex-shrink-0">
                      × rimuovi
                    </button>
                  </div>
                  {p.description && <p className="text-[10px] text-[var(--color-dim)] mt-1">{p.description}</p>}
                  {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[var(--color-blue)] font-mono">{p.url}</a>}
                </div>
              ))}
            </div>
          )}
          <FormField label="Nome progetto">
            <input type="text" value={form.proj_name} placeholder="Es. Job Hunter"
              onChange={e => set('proj_name', e.target.value)} />
          </FormField>
          <FormField label="Descrizione">
            <textarea rows={2} value={form.proj_description}
              placeholder="Breve descrizione del progetto"
              onChange={e => set('proj_description', e.target.value)} />
          </FormField>
          <FormField label="URL (opzionale)">
            <input type="url" value={form.proj_url} placeholder="https://github.com/..."
              onChange={e => set('proj_url', e.target.value)} />
          </FormField>
          <button type="button" onClick={addProject} disabled={!form.proj_name.trim()}
            className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed">
            + Aggiungi progetto
          </button>
        </FormSection>

        {/* ── Location preferences ── */}
        <FormSection title="Location preferite">
          <FormField label="Location accettate (separate da virgola)">
            <input type="text" value={form.location_preferences_raw}
              placeholder="Remote EU, Remote Worldwide, Hybrid Milano"
              onChange={e => set('location_preferences_raw', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Ruoli target ── */}
        <FormSection title="Ruoli target (in ordine di priorità)">
          <FormField label="Un ruolo per riga (dal più al meno prioritario)">
            <textarea rows={4} value={form.job_titles_raw}
              placeholder={'Backend Developer\nPython Developer\nFull Stack Developer'}
              onChange={e => set('job_titles_raw', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Salary ── */}
        <FormSection title="Salary Target">
          <FormRow>
            <FormField label="Italia min (€/anno)">
              <input type="number" value={form.salary_italy_min} placeholder="Es. 40000"
                onChange={e => set('salary_italy_min', e.target.value)} />
            </FormField>
            <FormField label="Italia max (€/anno)">
              <input type="number" value={form.salary_italy_max} placeholder="Es. 55000"
                onChange={e => set('salary_italy_max', e.target.value)} />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Remote EU min (€/anno)">
              <input type="number" value={form.salary_remote_eu_min} placeholder="Es. 50000"
                onChange={e => set('salary_remote_eu_min', e.target.value)} />
            </FormField>
            <FormField label="Remote EU max (€/anno)">
              <input type="number" value={form.salary_remote_eu_max} placeholder="Es. 70000"
                onChange={e => set('salary_remote_eu_max', e.target.value)} />
            </FormField>
          </FormRow>
        </FormSection>

        {/* ── Punti di forza ── */}
        <FormSection title="Punti di forza">
          <FormField label="Un punto di forza per riga">
            <textarea rows={3} value={form.strengths_raw}
              placeholder={'Problem solving\nComunicazione tecnica\nAutonomia'}
              onChange={e => set('strengths_raw', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Obiettivi di carriera ── */}
        <FormSection title="Obiettivi di Carriera">
          <FormRow>
            <FormField label="Direzione">
              <input type="text" value={form.cg_direction} placeholder="Es. Staff Engineer"
                onChange={e => set('cg_direction', e.target.value)} />
            </FormField>
            <FormField label="Job target">
              <input type="text" value={form.cg_target_job} placeholder="Es. Lead Backend Developer"
                onChange={e => set('cg_target_job', e.target.value)} />
            </FormField>
          </FormRow>
          <FormField label="Specializzazioni desiderate (una per riga)">
            <textarea rows={3} value={form.cg_specializations_raw}
              placeholder={'Distributed Systems\nMachine Learning\nCloud Architecture'}
              onChange={e => set('cg_specializations_raw', e.target.value)} />
          </FormField>
          <FormField label="Corsi desiderati (uno per riga)">
            <textarea rows={3} value={form.cg_desired_courses_raw}
              placeholder={'Kubernetes Advanced\nSystem Design\nData Engineering'}
              onChange={e => set('cg_desired_courses_raw', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Desideri & Aspirazioni ── */}
        <FormSection title="Desideri & Aspirazioni">
          <FormField label="Breve termine (1–2 anni)">
            <textarea rows={2} value={form.asp_short_term}
              placeholder="Cosa vuoi raggiungere nel breve termine?"
              onChange={e => set('asp_short_term', e.target.value)} />
          </FormField>
          <FormField label="Lungo termine (5+ anni)">
            <textarea rows={2} value={form.asp_long_term}
              placeholder="Dove vuoi essere tra 5 anni?"
              onChange={e => set('asp_long_term', e.target.value)} />
          </FormField>
          <FormField label="Aspirazioni ambiziose">
            <textarea rows={2} value={form.asp_ambitious}
              placeholder="Anche se sembra irraggiungibile, cosa ti piacerebbe davvero fare?"
              onChange={e => set('asp_ambitious', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Note libere ── */}
        <FormSection title="Note Libere">
          <FormField label="Tutto ciò che non rientra nelle categorie precedenti">
            <textarea rows={4} value={form.free_notes}
              placeholder="Vincoli particolari, preferenze di settore, disponibilità, note per gli agenti..."
              onChange={e => set('free_notes', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Upload file ── */}
        <FormSection title="File allegati">
          <p className="text-[10px] text-[var(--color-dim)] -mt-2 mb-2">
            Allega CV, cover letter o altri documenti. Formati: PDF, DOC, DOCX, TXT, MD, PNG, JPG (max 10MB ciascuno).
          </p>
          {uploadedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              {uploadedFiles.map(f => (
                <div key={f.name} className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[12px] text-[var(--color-bright)] truncate" title={f.name}>{f.name}</span>
                    <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <button type="button" onClick={() => handleDeleteFile(f.name)}
                    className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0 flex-shrink-0 ml-3">
                    × elimina
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
              onChange={handleUpload} className="hidden" id="file-upload" />
            <label htmlFor="file-upload"
              className="inline-flex items-center gap-2 px-4 py-2 border border-[var(--color-border)] rounded text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer">
              {uploading ? 'Upload in corso…' : '+ Aggiungi file'}
            </label>
          </div>
          {uploadError && (
            <p className="text-[10px] text-[var(--color-red)] mt-2">{uploadError}</p>
          )}
        </FormSection>

        {/* ── Submit ── */}
        {error && (
          <div className="px-4 py-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 rounded text-[11px] text-[var(--color-red)]">
            Errore: {error}
          </div>
        )}

        {success && (
          <div className="px-4 py-3 bg-[var(--color-green)]/10 border border-[var(--color-green)]/30 rounded text-[11px] text-[var(--color-green)]">
            Profilo salvato. Reindirizzamento...
          </div>
        )}

        <div className="flex gap-3 pb-8">
          <button type="submit" disabled={isPending || success}
            className="px-6 py-2.5 bg-[var(--color-green)] text-[var(--color-void)] text-[11px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
            {isPending ? 'Salvataggio...' : 'Salva profilo'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 border border-[var(--color-border)] text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] rounded hover:border-[var(--color-border-glow)] transition-colors cursor-pointer bg-transparent">
            Annulla
          </button>
        </div>
      </form>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6">
      <div className="section-label mb-5">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      {children}
    </div>
  )
}
