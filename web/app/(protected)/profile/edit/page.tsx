'use client'

import { useState, useEffect, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CandidateProfile, Language } from '@/lib/types'

type FormData = {
  name: string
  target_role: string
  location: string
  experience_years: string
  has_degree: boolean
  skills_raw: string
  location_preferences_raw: string
  job_titles_raw: string
  lang_language: string
  lang_level: string
  email: string
}

const INITIAL: FormData = {
  name: '', target_role: '', location: '', experience_years: '',
  has_degree: false, skills_raw: '', location_preferences_raw: '',
  job_titles_raw: '', lang_language: '', lang_level: '',
  email: '',
}

export default function ProfileEditPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<FormData>(INITIAL)
  const [languages, setLanguages] = useState<Language[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(true)

  // Carica profilo esistente
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('candidate_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single() as { data: CandidateProfile | null }

      if (data) {
        // Flatten skills object to comma-separated string
        const skillsFlat = data.skills
          ? Object.values(data.skills).flat().join(', ')
          : ''
        // Flatten location_preferences objects to readable strings
        const locPrefs = data.location_preferences
          ? data.location_preferences.map(lp => {
              const parts = [(lp.type ?? '').replace(/_/g, ' ')]
              if (lp.region) parts.push(lp.region)
              if (lp.cities) parts.push(lp.cities.join('/'))
              if (lp.note) parts.push(lp.note)
              return parts.join(' ')
            }).join(', ')
          : ''

        setForm({
          name: data.name ?? '',
          target_role: data.target_role ?? '',
          location: data.location ?? '',
          experience_years: data.experience_years != null ? String(data.experience_years) : '',
          has_degree: data.has_degree,
          skills_raw: skillsFlat,
          location_preferences_raw: locPrefs,
          job_titles_raw: (data.job_titles ?? []).join('\n'),
          lang_language: '',
          lang_level: '',
          email: data.email ?? '',
        })
        setLanguages(data.languages ?? [])
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof FormData, value: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const addLanguage = () => {
    if (!form.lang_language.trim()) return
    setLanguages(prev => [...prev, { language: form.lang_language.trim(), level: form.lang_level.trim() || 'n/a' }])
    setForm(prev => ({ ...prev, lang_language: '', lang_level: '' }))
  }

  const removeLanguage = (idx: number) =>
    setLanguages(prev => prev.filter((_, i) => i !== idx))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessione scaduta'); return }

      const skillsList = form.skills_raw.split(',').map(s => s.trim()).filter(Boolean)
      const payload = {
        user_id: user.id,
        name: form.name || null,
        email: form.email || null,
        target_role: form.target_role || null,
        location: form.location || null,
        experience_years: form.experience_years ? parseInt(form.experience_years) : null,
        has_degree: form.has_degree,
        skills: { general: skillsList },
        location_preferences: form.location_preferences_raw.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ type: s })),
        job_titles: form.job_titles_raw.split('\n').map(s => s.trim()).filter(Boolean),
        languages,
        updated_at: new Date().toISOString(),
      }

      const { error: err } = await supabase
        .from('candidate_profiles')
        .upsert(payload, { onConflict: 'user_id' })

      if (err) {
        setError(err.message)
      } else {
        setSuccess(true)
        setTimeout(() => router.push('/profile'), 800)
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
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          Modifica Profilo
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          Questi dati vengono usati dagli agenti per personalizzare CV e cover letter
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">

        {/* ── Info Base ──────────────────────────────────────── */}
        <FormSection title="Info Base">
          <FormRow>
            <FormField label="Nome completo">
              <input
                type="text" value={form.name} placeholder="Es. Mario Rossi"
                onChange={e => set('name', e.target.value)}
              />
            </FormField>
            <FormField label="Ruolo target principale">
              <input
                type="text" value={form.target_role} placeholder="Es. Backend Developer"
                onChange={e => set('target_role', e.target.value)}
              />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Location">
              <input
                type="text" value={form.location} placeholder="Es. Remote EU"
                onChange={e => set('location', e.target.value)}
              />
            </FormField>
            <FormField label="Anni di esperienza">
              <input
                type="number" min="0" max="40" value={form.experience_years}
                placeholder="Es. 3"
                onChange={e => set('experience_years', e.target.value)}
              />
            </FormField>
          </FormRow>
          <div className="flex items-center gap-3 mt-2">
            <input
              type="checkbox" id="degree" checked={form.has_degree}
              onChange={e => set('has_degree', e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-[var(--color-green)]"
              style={{ width: '16px', padding: 0 }}
            />
            <label htmlFor="degree" className="text-[11px] text-[var(--color-base)] cursor-pointer mb-0 normal-case tracking-normal font-normal">
              Ho una laurea (triennale o magistrale)
            </label>
          </div>
        </FormSection>

        {/* ── Email ──────────────────────────────────────────── */}
        <FormSection title="Contatto">
          <FormField label="Email">
            <input type="email" value={form.email} placeholder="nome@example.com"
              onChange={e => set('email', e.target.value)} />
          </FormField>
        </FormSection>

        {/* ── Skills ─────────────────────────────────────────── */}
        <FormSection title="Skills">
          <FormField label="Skills (separate da virgola)">
            <textarea
              rows={3} value={form.skills_raw}
              placeholder="Python, JavaScript, FastAPI, PostgreSQL, Docker, Git"
              onChange={e => set('skills_raw', e.target.value)}
            />
          </FormField>
          <p className="text-[10px] text-[var(--color-dim)] mt-1">
            Elenca tutte le skill tecniche rilevanti, separate da virgola.
          </p>
        </FormSection>

        {/* ── Lingue ─────────────────────────────────────────── */}
        <FormSection title="Lingue">
          {languages.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              {languages.map((l, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded"
                >
                  <span className="text-[12px] text-[var(--color-bright)]">{l.language}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--color-muted)]">{l.level}</span>
                    <button
                      type="button" onClick={() => removeLanguage(i)}
                      className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0"
                    >
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
              <select
                value={form.lang_level}
                onChange={e => set('lang_level', e.target.value)}
              >
                <option value="">— seleziona —</option>
                {['madrelingua','C2','C1','B2','B1','A2','A1'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </FormField>
          </FormRow>
          <button
            type="button" onClick={addLanguage}
            className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0"
          >
            + Aggiungi lingua
          </button>
        </FormSection>

        {/* ── Location preferences ───────────────────────────── */}
        <FormSection title="Location preferite">
          <FormField label="Location accettate (separate da virgola)">
            <input
              type="text" value={form.location_preferences_raw}
              placeholder="Remote EU, Remote Worldwide, Hybrid Milano"
              onChange={e => set('location_preferences_raw', e.target.value)}
            />
          </FormField>
        </FormSection>

        {/* ── Target roles ───────────────────────────────────── */}
        <FormSection title="Ruoli target (in ordine di priorità)">
          <FormField label="Un ruolo per riga (dal più al meno prioritario)">
            <textarea
              rows={4} value={form.job_titles_raw}
              placeholder={'Backend Developer\nPython Developer\nFull Stack Developer'}
              onChange={e => set('job_titles_raw', e.target.value)}
            />
          </FormField>
        </FormSection>

        {/* ── Submit ─────────────────────────────────────────── */}
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
          <button
            type="submit"
            disabled={isPending || success}
            className="px-6 py-2.5 bg-[var(--color-green)] text-[var(--color-void)] text-[11px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Salvataggio...' : 'Salva profilo'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 border border-[var(--color-border)] text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] rounded hover:border-[var(--color-border-glow)] transition-colors cursor-pointer bg-transparent"
          >
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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      {children}
    </div>
  )
}
