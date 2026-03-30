'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import type { CandidateProfile, Language } from '@/lib/types'

interface Props {
  profile: CandidateProfile | null
}

type FormState = {
  name: string
  target_role: string
  location: string
  experience_years: string
  has_degree: boolean
  email: string
  skills_raw: string
  languages: Language[]
  lang_language: string
  lang_level: string
  job_titles_raw: string
  location_preferences_raw: string
}

function profileToForm(p: CandidateProfile | null): FormState {
  if (!p) {
    return {
      name: '', target_role: '', location: '', experience_years: '',
      has_degree: false, email: '', skills_raw: '', languages: [],
      lang_language: '', lang_level: '', job_titles_raw: '',
      location_preferences_raw: '',
    }
  }
  return {
    name: p.name ?? '',
    target_role: p.target_role ?? '',
    location: p.location ?? '',
    experience_years: p.experience_years != null ? String(p.experience_years) : '',
    has_degree: p.has_degree ?? false,
    email: p.email ?? '',
    skills_raw: p.skills ? Object.values(p.skills).flat().join(', ') : '',
    languages: p.languages ?? [],
    lang_language: '',
    lang_level: '',
    job_titles_raw: (p.job_titles ?? []).join('\n'),
    location_preferences_raw: (p.location_preferences ?? [])
      .map(lp => (typeof lp === 'string' ? lp : (lp.type ?? '')))
      .join(', '),
  }
}

function formToPayload(form: FormState) {
  const skillsList = form.skills_raw.split(',').map(s => s.trim()).filter(Boolean)
  return {
    name: form.name || null,
    email: form.email || null,
    target_role: form.target_role || null,
    location: form.location || null,
    experience_years: form.experience_years ? parseInt(form.experience_years) : null,
    has_degree: form.has_degree,
    skills: skillsList.length ? { general: skillsList } : null,
    languages: form.languages.length ? form.languages : null,
    job_titles: form.job_titles_raw.split('\n').map(s => s.trim()).filter(Boolean),
    location_preferences: form.location_preferences_raw
      .split(',').map(s => s.trim()).filter(Boolean).map(s => ({ type: s })),
  }
}

// Merge proposed_changes (from CV extraction) into form state
function mergeProposed(form: FormState, proposed: Record<string, unknown>): FormState {
  const next = { ...form }

  if (typeof proposed.name === 'string' && proposed.name) next.name = proposed.name
  if (typeof proposed.email === 'string' && proposed.email) next.email = proposed.email
  if (typeof proposed.target_role === 'string' && proposed.target_role) next.target_role = proposed.target_role
  if (typeof proposed.location === 'string' && proposed.location) next.location = proposed.location
  if (typeof proposed.experience_years === 'number') next.experience_years = String(proposed.experience_years)
  if (typeof proposed.has_degree === 'boolean') next.has_degree = proposed.has_degree

  if (proposed.skills) {
    let flat: string[] = []
    if (Array.isArray(proposed.skills)) {
      flat = proposed.skills as string[]
    } else if (typeof proposed.skills === 'object') {
      flat = Object.values(proposed.skills as Record<string, string[]>).flat()
    }
    if (flat.length) next.skills_raw = flat.join(', ')
  }

  if (Array.isArray(proposed.languages)) {
    const langs = (proposed.languages as Array<{ language?: string; level?: string }>)
      .filter(l => l.language)
      .map(l => ({ language: l.language!, level: l.level ?? '' }))
    if (langs.length) next.languages = langs
  }

  if (Array.isArray(proposed.job_titles)) {
    const titles = (proposed.job_titles as string[]).filter(Boolean)
    if (titles.length) next.job_titles_raw = titles.join('\n')
  }

  // Extract contacts from positioning if present
  const positioning = proposed.positioning as Record<string, unknown> | undefined
  const contacts = positioning?.contacts as Record<string, string> | undefined
  if (contacts?.email && !next.email) next.email = contacts.email

  return next
}

export default function ProfilePageClient({ profile }: Props) {
  const [form, setForm] = useState<FormState>(() => profileToForm(profile))
  const [editing, setEditing] = useState(!profile)

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractedCount, setExtractedCount] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Save state
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const set = useCallback((key: keyof FormState, value: string | boolean | Language[]) =>
    setForm(prev => ({ ...prev, [key]: value })), [])

  const addLanguage = () => {
    if (!form.lang_language.trim()) return
    set('languages', [...form.languages, {
      language: form.lang_language.trim(),
      level: form.lang_level || 'n/a',
    }])
    set('lang_language', '')
    set('lang_level', '')
  }

  const removeLanguage = (idx: number) =>
    set('languages', form.languages.filter((_, i) => i !== idx))

  // File selection
  const handleFile = useCallback((file: File) => {
    if (file.type !== 'application/pdf') {
      setExtractError('Formato non supportato. Carica un file PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setExtractError('File troppo grande (max 10 MB).')
      return
    }
    setSelectedFile(file)
    setExtractError(null)
    setExtractedCount(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  // Extract info from CV
  const handleExtract = async () => {
    if (!selectedFile) return
    setExtracting(true)
    setExtractError(null)
    setExtractedCount(null)

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const res = await fetch('/api/profile-assistant/upload-cv', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setExtractError(data.error ?? `Errore HTTP ${res.status}`)
      } else if (data.proposed_changes) {
        const merged = mergeProposed(form, data.proposed_changes)
        setForm(merged)
        const count = Object.values(data.proposed_changes).filter(v => v !== null && v !== undefined).length
        setExtractedCount(count)
        setEditing(true)
      } else {
        setExtractError('Nessuna informazione estratta dal documento.')
      }
    } catch {
      setExtractError('Impossibile raggiungere il server.')
    } finally {
      setExtracting(false)
    }
  }

  // Save profile
  const handleSave = async () => {
    if (!form.name.trim() && !form.target_role.trim()) {
      setSaveError('Compila almeno Nome o Ruolo target prima di salvare.')
      return
    }
    setSaving(true)
    setSaveError(null)

    try {
      const res = await fetch('/api/profile-assistant/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: formToPayload(form), confirmed: true }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setSaveError(data.error ?? `Errore HTTP ${res.status}`)
      } else {
        setSaveSuccess(true)
        setTimeout(() => window.location.reload(), 800)
      }
    } catch {
      setSaveError('Impossibile raggiungere il server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Hint assistente ─────────────────────────────────────── */}
      <div className="mb-6 flex items-start gap-4 px-5 py-4 rounded-lg border border-[var(--color-green)]/20 bg-[var(--color-green)]/5">
        <div className="text-[var(--color-green)] mt-0.5 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-base)] leading-relaxed">
            Vuoi compilare il profilo in modo guidato?{' '}
            <Link href="/assistente" className="text-[var(--color-green)] font-semibold hover:underline">
              Chatta con l&apos;Assistente →
            </Link>{' '}
            ti farà domande sulla tua storia professionale e completerà il profilo al 100%.
          </p>
        </div>
      </div>

      {/* ── Upload CV ───────────────────────────────────────────── */}
      <div className="mb-8 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">setup</span>
          <span className="text-[var(--color-dim)] text-[10px]">/</span>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">carica cv</span>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-[var(--color-muted)] mb-4 leading-relaxed">
            Carica il tuo CV in PDF. I dati verranno estratti automaticamente e pre-compilati nel profilo qui sotto.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="relative border-2 border-dashed rounded-lg px-6 py-8 text-center cursor-pointer transition-colors"
            style={{
              borderColor: dragOver ? 'var(--color-green)' : selectedFile ? 'var(--color-green)' : 'var(--color-border)',
              background: dragOver ? 'var(--color-green)/5' : 'var(--color-panel)',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
            <div className="flex flex-col items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                style={{ color: selectedFile ? 'var(--color-green)' : 'var(--color-dim)' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {selectedFile ? (
                <span className="text-[11px] font-semibold text-[var(--color-green)]">{selectedFile.name}</span>
              ) : (
                <>
                  <span className="text-[11px] text-[var(--color-muted)]">Trascina il CV qui oppure</span>
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
                    clicca per sfogliare
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleExtract}
              disabled={!selectedFile || extracting}
              className="px-5 py-2 rounded text-[11px] font-bold tracking-wide transition-all cursor-pointer border-0"
              style={{
                background: selectedFile && !extracting ? 'var(--color-green)' : 'var(--color-border)',
                color: selectedFile && !extracting ? '#000' : 'var(--color-dim)',
                cursor: selectedFile && !extracting ? 'pointer' : 'not-allowed',
              }}
            >
              {extracting ? 'Estrazione in corso…' : 'Estrai informazioni'}
            </button>

            {extractedCount !== null && (
              <span className="text-[10px] font-semibold text-[var(--color-green)]">
                ✓ {extractedCount} campi estratti — profilo pre-compilato
              </span>
            )}
          </div>

          {extractError && (
            <p className="mt-2 text-[10px] text-[var(--color-red)]">{extractError}</p>
          )}
        </div>
      </div>

      {/* ── Form profilo ────────────────────────────────────────── */}
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">profilo</span>
            <span className="text-[var(--color-dim)] text-[10px]">/</span>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
              {editing ? 'modifica' : 'candidato'}
            </span>
          </div>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-green)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              Modifica
            </button>
          )}
          {editing && profile && (
            <button
              onClick={() => { setForm(profileToForm(profile)); setEditing(false); setSaveError(null) }}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              Annulla
            </button>
          )}
        </div>

        <div className="p-5">
          {editing ? (
            /* ── Edit mode ─── */
            <div className="space-y-6">

              {/* Info base */}
              <FieldGroup title="Info Base">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Nome completo">
                    <input type="text" value={form.name} placeholder="Es. Mario Rossi"
                      onChange={e => set('name', e.target.value)} />
                  </Field>
                  <Field label="Ruolo target">
                    <input type="text" value={form.target_role} placeholder="Es. Backend Developer"
                      onChange={e => set('target_role', e.target.value)} />
                  </Field>
                  <Field label="Location">
                    <input type="text" value={form.location} placeholder="Es. Remote EU"
                      onChange={e => set('location', e.target.value)} />
                  </Field>
                  <Field label="Anni di esperienza">
                    <input type="number" min="0" max="40" value={form.experience_years}
                      placeholder="Es. 3" onChange={e => set('experience_years', e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={form.email} placeholder="nome@example.com"
                      onChange={e => set('email', e.target.value)} />
                  </Field>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <input type="checkbox" id="degree" checked={form.has_degree}
                    onChange={e => set('has_degree', e.target.checked)}
                    className="w-4 h-4 cursor-pointer accent-[var(--color-green)]"
                    style={{ width: '16px', padding: 0 }} />
                  <label htmlFor="degree" className="text-[11px] text-[var(--color-base)] cursor-pointer mb-0 normal-case tracking-normal font-normal">
                    Ho una laurea
                  </label>
                </div>
              </FieldGroup>

              {/* Skills */}
              <FieldGroup title="Skills">
                <Field label="Skills (separate da virgola)">
                  <textarea rows={3} value={form.skills_raw}
                    placeholder="Python, TypeScript, FastAPI, PostgreSQL, Docker"
                    onChange={e => set('skills_raw', e.target.value)} />
                </Field>
              </FieldGroup>

              {/* Lingue */}
              <FieldGroup title="Lingue">
                {form.languages.length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-3">
                    {form.languages.map((l, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded text-[12px]">
                        <span className="text-[var(--color-bright)]">{l.language}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[var(--color-muted)]">{l.level}</span>
                          <button type="button" onClick={() => removeLanguage(i)}
                            className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0">
                            × rimuovi
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Lingua">
                    <input type="text" value={form.lang_language} placeholder="Es. inglese"
                      onChange={e => set('lang_language', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLanguage())} />
                  </Field>
                  <Field label="Livello">
                    <select value={form.lang_level} onChange={e => set('lang_level', e.target.value)}>
                      <option value="">— seleziona —</option>
                      {['madrelingua', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'].map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button type="button" onClick={addLanguage} disabled={!form.lang_language.trim()}
                  className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed">
                  + Aggiungi lingua
                </button>
              </FieldGroup>

              {/* Ruoli target */}
              <FieldGroup title="Ruoli target (in ordine di priorità)">
                <Field label="Un ruolo per riga">
                  <textarea rows={4} value={form.job_titles_raw}
                    placeholder={'Backend Developer\nPython Developer\nFull Stack Developer'}
                    onChange={e => set('job_titles_raw', e.target.value)} />
                </Field>
              </FieldGroup>

              {/* Location preferences */}
              <FieldGroup title="Location preferite">
                <Field label="Location accettate (separate da virgola)">
                  <input type="text" value={form.location_preferences_raw}
                    placeholder="Remote EU, Remote Worldwide, Hybrid Milano"
                    onChange={e => set('location_preferences_raw', e.target.value)} />
                </Field>
              </FieldGroup>

              {/* Save */}
              {saveError && (
                <div className="px-4 py-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 rounded text-[11px] text-[var(--color-red)]">
                  {saveError}
                </div>
              )}
              {saveSuccess && (
                <div className="px-4 py-3 bg-[var(--color-green)]/10 border border-[var(--color-green)]/30 rounded text-[11px] text-[var(--color-green)]">
                  Profilo salvato. Ricarico...
                </div>
              )}
              <div className="flex gap-3 pb-2">
                <button
                  onClick={handleSave}
                  disabled={saving || saveSuccess}
                  className="px-6 py-2.5 text-[11px] font-bold tracking-widest uppercase rounded transition-all cursor-pointer border-0"
                  style={{
                    background: saving || saveSuccess ? 'var(--color-border)' : 'var(--color-green)',
                    color: saving || saveSuccess ? 'var(--color-dim)' : '#000',
                    cursor: saving || saveSuccess ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Salvataggio...' : saveSuccess ? 'Salvato!' : 'Salva profilo'}
                </button>
                {profile && (
                  <button type="button" onClick={() => { setForm(profileToForm(profile)); setEditing(false); setSaveError(null) }}
                    className="px-5 py-2.5 border border-[var(--color-border)] text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] rounded hover:border-[var(--color-border-glow)] transition-colors cursor-pointer bg-transparent">
                    Annulla
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* ── View mode ─── */
            profile ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ViewSection title="Info Base">
                  <ViewField label="Nome" value={profile.name} />
                  <ViewField label="Ruolo target" value={profile.target_role} />
                  <ViewField label="Location" value={profile.location} />
                  <ViewField label="Esperienza" value={profile.experience_years != null ? `${profile.experience_years} anni` : null} />
                  <ViewField label="Laurea" value={profile.has_degree ? 'Sì' : 'No'} />
                  <ViewField label="Email" value={profile.email} />
                </ViewSection>

                <ViewSection title="Lingue">
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
                </ViewSection>

                <ViewSection title="Skills">
                  {profile.skills ? (
                    <div className="flex flex-col gap-3">
                      {Object.entries(profile.skills).map(([cat, items]) => (
                        <div key={cat}>
                          <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-1.5">
                            {cat.replace(/_/g, ' ')}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(items as string[]).map(s => (
                              <span key={s} className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded bg-[var(--color-blue)]/10 text-[var(--color-blue)] border border-[var(--color-blue)]/20">
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
                </ViewSection>

                <ViewSection title="Ruoli target">
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
                </ViewSection>

                <ViewSection title="Location preferite">
                  {profile.location_preferences && profile.location_preferences.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.location_preferences.map((lp, i) => (
                        <span key={i} className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--color-green)]/10 text-[var(--color-green)] border border-[var(--color-green)]/20">
                          {(lp.type ?? '').replace(/_/g, ' ')}
                          {lp.region ? ` · ${lp.region}` : ''}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[var(--color-dim)] text-[11px]">Nessuna preferenza</span>
                  )}
                </ViewSection>

                {profile.salary_target && (profile.salary_target.italy_min != null || profile.salary_target.remote_eu_min != null) && (
                  <ViewSection title="Salary target">
                    {profile.salary_target.italy_min != null && (
                      <ViewField label="Italia" value={`€${profile.salary_target.italy_min.toLocaleString()}–${(profile.salary_target.italy_max ?? profile.salary_target.italy_min).toLocaleString()}`} />
                    )}
                    {profile.salary_target.remote_eu_min != null && (
                      <ViewField label="Remote EU" value={`€${profile.salary_target.remote_eu_min.toLocaleString()}–${(profile.salary_target.remote_eu_max ?? profile.salary_target.remote_eu_min).toLocaleString()}`} />
                    )}
                  </ViewSection>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-[var(--color-dim)] text-3xl mb-3 font-mono">[ ]</div>
                <p className="text-[11px] text-[var(--color-muted)] mb-4">
                  Nessun profilo configurato. Carica il CV sopra oppure compila i campi manualmente.
                </p>
                <button
                  onClick={() => setEditing(true)}
                  className="px-5 py-2 bg-[var(--color-green)] text-black text-[11px] font-bold tracking-widest uppercase rounded cursor-pointer border-0 hover:opacity-90 transition-opacity"
                >
                  Compila manualmente
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[9.5px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function ViewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">{title}</div>
      {children}
    </div>
  )
}

function ViewField({ label, value }: { label: string; value?: string | null }) {
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
