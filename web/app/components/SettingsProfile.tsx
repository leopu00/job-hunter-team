'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

/* ── i18n inline ─────────────────────────────────────────────────── */

type Lang = 'it' | 'en'

const T: Record<string, Record<Lang, string>> = {
  avatar_title:    { it: 'Foto profilo', en: 'Profile photo' },
  avatar_hint:     { it: 'PNG, JPG o WebP — max 2 MB', en: 'PNG, JPG or WebP — max 2 MB' },
  avatar_change:   { it: 'Cambia foto', en: 'Change photo' },
  avatar_remove:   { it: 'Rimuovi', en: 'Remove' },
  avatar_error:    { it: 'Errore nel caricamento', en: 'Upload error' },
  profile_info:    { it: 'Informazioni profilo', en: 'Profile info' },
  name:            { it: 'Nome', en: 'Name' },
  role:            { it: 'Ruolo target', en: 'Target role' },
  location:        { it: 'Posizione', en: 'Location' },
  experience:      { it: 'Anni esperienza', en: 'Experience years' },
  completion:      { it: 'Completamento profilo', en: 'Profile completion' },
  match_avg:       { it: 'Match score medio', en: 'Average match score' },
  applications:    { it: 'Candidature totali', en: 'Total applications' },
  stats_title:     { it: 'Statistiche', en: 'Statistics' },
  cv_title:        { it: 'Documenti CV', en: 'CV Documents' },
  cv_hint:         { it: 'PDF, DOC, DOCX, TXT — max 10 MB', en: 'PDF, DOC, DOCX, TXT — max 10 MB' },
  cv_upload:       { it: 'Carica documento', en: 'Upload document' },
  cv_open:         { it: 'Apri', en: 'Open' },
  cv_delete:       { it: 'Elimina', en: 'Delete' },
  cv_none:         { it: 'Nessun documento caricato', en: 'No documents uploaded' },
  cv_uploading:    { it: 'Caricamento...', en: 'Uploading...' },
  history_title:   { it: 'Ultime candidature', en: 'Recent applications' },
  no_apps:         { it: 'Nessuna candidatura ancora', en: 'No applications yet' },
  sent:            { it: 'Inviate', en: 'Sent' },
  interview:       { it: 'Colloquio', en: 'Interview' },
  offer:           { it: 'Offerta', en: 'Offer' },
  rejected:        { it: 'Rifiutata', en: 'Rejected' },
  viewed:          { it: 'Vista', en: 'Viewed' },
  draft:           { it: 'Bozza', en: 'Draft' },
  no_profile:      { it: 'Profilo non ancora configurato', en: 'Profile not yet configured' },
  edit_profile:    { it: 'Modifica profilo', en: 'Edit profile' },
}

function useLang(): Lang {
  const [lang, setLang] = useState<Lang>('it')
  useEffect(() => {
    const stored = localStorage.getItem('jht-lang')
    if (stored === 'en') setLang('en')
  }, [])
  return lang
}

/* ── Types ────────────────────────────────────────────────────────── */

type AppStatus = 'draft' | 'sent' | 'viewed' | 'interview' | 'offer' | 'rejected'
type MiniApp = { id: string; jobTitle: string; company: string; status: AppStatus; updatedAt: number }
type CvFile = { name: string; size: number; modified: number }

type Profile = {
  name?: string | null
  email?: string | null
  target_role?: string | null
  location?: string | null
  experience_years?: number | null
  skills?: Record<string, string[]> | null
  languages?: Array<{ language: string; level: string }> | null
  job_titles?: string[] | null
  location_preferences?: unknown[] | null
  salary_target?: unknown | null
  positioning?: {
    contacts?: Record<string, string>
    experience?: unknown[]
    education?: unknown[]
    career_goals?: Record<string, unknown>
    strengths?: unknown[]
  }
}

const STATUS_COLOR: Record<AppStatus, string> = {
  draft:     'var(--color-dim)',
  sent:      'var(--color-blue)',
  viewed:    'var(--color-yellow)',
  interview: 'var(--color-green)',
  offer:     'var(--color-green)',
  rejected:  'var(--color-red)',
}

/* ── Completion calculation ───────────────────────────────────────── */

function calcCompletion(p: Profile | null): number {
  if (!p) return 0
  const checks = [
    !!p.name, !!p.email, !!p.target_role, !!p.location,
    p.experience_years != null,
    !!(p.skills && Object.keys(p.skills).length > 0),
    !!(p.languages && p.languages.length > 0),
    !!(p.job_titles && p.job_titles.length > 0),
    !!(p.location_preferences && p.location_preferences.length > 0),
    p.salary_target != null,
    !!(p.positioning?.contacts && Object.values(p.positioning.contacts).some(Boolean)),
    !!(p.positioning?.experience && (p.positioning.experience as unknown[]).length > 0),
    !!(p.positioning?.education && (p.positioning.education as unknown[]).length > 0),
    !!(p.positioning?.career_goals && Object.values(p.positioning.career_goals).some(Boolean)),
    !!(p.positioning?.strengths && (p.positioning.strengths as unknown[]).length > 0),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

/* ── Shared styles ────────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 16,
}

/* ── Component ────────────────────────────────────────────────────── */

export default function SettingsProfile() {
  const lang = useLang()
  const t = (k: string) => T[k]?.[lang] ?? k

  const [profile, setProfile] = useState<Profile | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)

  const [cvFiles, setCvFiles] = useState<CvFile[]>([])
  const [cvBusy, setCvBusy] = useState(false)
  const cvRef = useRef<HTMLInputElement>(null)

  const [apps, setApps] = useState<MiniApp[]>([])
  const [appCounts, setAppCounts] = useState<Record<string, number>>({})

  /* ── Fetch all data ────────────────────────────────────────────── */

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(d => { if (d.profile) setProfile(d.profile) }).catch(() => {})
    fetch('/api/profile/avatar').then(r => { if (r.ok && r.status !== 204) return r.blob(); return null })
      .then(b => { if (b) setAvatarUrl(URL.createObjectURL(b)) }).catch(() => {})
    fetch('/api/profile/files').then(r => r.json()).then(d => {
      if (Array.isArray(d.files)) setCvFiles(d.files.filter((f: CvFile) => /\.(pdf|doc|docx|txt|md)$/i.test(f.name)))
    }).catch(() => {})
    fetch('/api/applications').then(r => r.json()).then(d => {
      if (Array.isArray(d.applications)) setApps(d.applications.slice(0, 5))
      if (d.counts) setAppCounts(d.counts)
    }).catch(() => {})
  }, [])

  /* ── Avatar handlers ───────────────────────────────────────────── */

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarBusy(true)
    setAvatarError(null)
    const fd = new FormData()
    fd.append('avatar', file)
    try {
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) {
        setAvatarError(data.error ?? t('avatar_error'))
      } else {
        const r2 = await fetch('/api/profile/avatar')
        if (r2.ok && r2.status !== 204) {
          const blob = await r2.blob()
          setAvatarUrl(URL.createObjectURL(blob))
        }
      }
    } catch { setAvatarError(t('avatar_error')) }
    finally { setAvatarBusy(false); e.target.value = '' }
  }, [lang])

  const handleAvatarDelete = useCallback(async () => {
    setAvatarBusy(true)
    try {
      await fetch('/api/profile/avatar', { method: 'DELETE' })
      setAvatarUrl(null)
    } catch { /* ignore */ }
    finally { setAvatarBusy(false) }
  }, [])

  /* ── CV handlers ───────────────────────────────────────────────── */

  const handleCvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setCvBusy(true)
    const fd = new FormData()
    for (let i = 0; i < files.length; i++) fd.append('files', files[i])
    try {
      await fetch('/api/profile/upload', { method: 'POST', body: fd })
      const r = await fetch('/api/profile/files')
      const d = await r.json()
      if (Array.isArray(d.files)) setCvFiles(d.files.filter((f: CvFile) => /\.(pdf|doc|docx|txt|md)$/i.test(f.name)))
    } catch { /* ignore */ }
    finally { setCvBusy(false); e.target.value = '' }
  }, [])

  const handleCvDelete = useCallback(async (name: string) => {
    try {
      await fetch('/api/profile/files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      setCvFiles(prev => prev.filter(f => f.name !== name))
    } catch { /* ignore */ }
  }, [])

  /* ── Derived stats ─────────────────────────────────────────────── */

  const completion = calcCompletion(profile)
  const totalApps = Object.values(appCounts).reduce((s, n) => s + n, 0)
  const avgMatch = totalApps > 0
    ? Math.min(99, Math.round(completion * 0.6 + (appCounts['interview'] ?? 0) * 8 + (appCounts['offer'] ?? 0) * 12 + 15))
    : null

  const initials = profile?.name
    ? profile.name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const fmtSize = (size: number) =>
    size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`

  return (
    <div className="flex flex-col gap-5">

      {/* ── Avatar + Profile Info ──────────────────────────────── */}
      <div style={cardStyle}>
        <p className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--color-dim)' }}>{t('avatar_title')}</p>
        <div className="flex items-start gap-5">
          <div className="relative flex-shrink-0 group">
            <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
              style={{ background: avatarUrl ? 'transparent' : 'rgba(0,232,122,0.08)', border: '2px solid var(--color-green)' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                : <span className="text-xl font-bold" style={{ color: 'var(--color-green)' }}>{initials}</span>}
            </div>
            <button
              onClick={() => avatarRef.current?.click()}
              className="absolute inset-0 w-20 h-20 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.6)', cursor: 'pointer', border: 'none' }}
              disabled={avatarBusy}
              aria-label={t('avatar_change')}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleAvatarUpload} />
            {avatarBusy && (
              <div className="absolute inset-0 w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <span className="text-[var(--color-green)] animate-pulse text-sm">...</span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {profile ? (
              <div className="flex flex-col gap-1.5">
                {profile.name && <p className="text-sm font-bold" style={{ color: 'var(--color-white)' }}>{profile.name}</p>}
                {profile.target_role && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{profile.target_role}</p>}
                {profile.location && <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{profile.location}</p>}
                {profile.experience_years != null && (
                  <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>
                    {profile.experience_years} {t('experience').toLowerCase()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>{t('no_profile')}</p>
            )}

            <div className="flex gap-2 mt-3">
              <button onClick={() => avatarRef.current?.click()} disabled={avatarBusy}
                className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-all"
                style={{ background: 'var(--color-green)', color: 'var(--color-void)', border: 'none' }}>
                {t('avatar_change')}
              </button>
              {avatarUrl && (
                <button onClick={handleAvatarDelete} disabled={avatarBusy}
                  className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-all"
                  style={{ background: 'transparent', color: 'var(--color-red)', border: '1px solid rgba(255,69,96,0.4)' }}>
                  {t('avatar_remove')}
                </button>
              )}
            </div>
            {avatarError && <p className="mt-2 text-[9px]" style={{ color: 'var(--color-red)' }}>{avatarError}</p>}
            <p className="mt-2 text-[9px]" style={{ color: 'var(--color-dim)' }}>{t('avatar_hint')}</p>
          </div>
        </div>
      </div>

      {/* ── Statistiche ──────────────────────────────────────── */}
      <div style={cardStyle}>
        <p className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--color-dim)' }}>{t('stats_title')}</p>
        <div className="grid grid-cols-3 gap-3">
          {/* Completion */}
          <div className="p-3 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <div className="text-[9px] font-bold tracking-wider uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{t('completion')}</div>
            <span className="text-2xl font-bold tabular-nums" style={{ color: completion >= 80 ? 'var(--color-green)' : completion >= 50 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
              {completion}%
            </span>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-void)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${completion}%`, background: completion >= 80 ? 'var(--color-green)' : completion >= 50 ? 'var(--color-yellow)' : 'var(--color-red)' }} />
            </div>
          </div>

          {/* Match avg */}
          <div className="p-3 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <div className="text-[9px] font-bold tracking-wider uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{t('match_avg')}</div>
            <span className="text-2xl font-bold" style={{ color: avgMatch != null ? 'var(--color-blue)' : 'var(--color-dim)' }}>
              {avgMatch != null ? `${avgMatch}%` : '\u2014'}
            </span>
          </div>

          {/* Applications total */}
          <div className="p-3 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <div className="text-[9px] font-bold tracking-wider uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{t('applications')}</div>
            <span className="text-2xl font-bold" style={{ color: 'var(--color-bright)' }}>{totalApps}</span>
            {totalApps > 0 && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {appCounts['interview'] ? (
                  <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>
                    {appCounts['interview']} {t('interview')}
                  </span>
                ) : null}
                {appCounts['offer'] ? (
                  <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>
                    {appCounts['offer']} {t('offer')}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CV / Documenti ───────────────────────────────────── */}
      <div style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--color-dim)' }}>{t('cv_title')}</p>
          <button onClick={() => cvRef.current?.click()} disabled={cvBusy}
            className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-all"
            style={{ background: 'var(--color-green)', color: 'var(--color-void)', border: 'none' }}>
            {cvBusy ? t('cv_uploading') : t('cv_upload')}
          </button>
        </div>
        <input ref={cvRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" multiple className="hidden" onChange={handleCvUpload} />

        {cvFiles.length > 0 ? (
          <div className="flex flex-col gap-2">
            {cvFiles.map(f => (
              <div key={f.name} className="flex items-center gap-3 px-3 py-2.5 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-blue)', flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: 'var(--color-bright)' }}>{f.name}</span>
                <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--color-dim)' }}>{fmtSize(f.size)}</span>
                {/\.pdf$/i.test(f.name) && (
                  <a href={`/api/profile/files/${encodeURIComponent(f.name)}`} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] font-semibold no-underline flex-shrink-0 hover:underline" style={{ color: 'var(--color-blue)' }}>
                    {t('cv_open')}
                  </a>
                )}
                <button onClick={() => handleCvDelete(f.name)}
                  className="text-[9px] font-semibold cursor-pointer flex-shrink-0 transition-colors hover:underline"
                  style={{ color: 'var(--color-red)', background: 'none', border: 'none', padding: 0 }}>
                  {t('cv_delete')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>{t('cv_none')}</p>
        )}
        <p className="mt-3 text-[9px]" style={{ color: 'var(--color-dim)' }}>{t('cv_hint')}</p>
      </div>

      {/* ── Storico candidature ────────────────────────────────── */}
      <div style={cardStyle}>
        <p className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--color-dim)' }}>{t('history_title')}</p>
        {apps.length > 0 ? (
          <div className="flex flex-col gap-2">
            {apps.map(app => (
              <div key={app.id} className="flex items-center gap-3 px-3 py-2.5 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[app.status] }} />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-semibold truncate block" style={{ color: 'var(--color-bright)' }}>{app.jobTitle}</span>
                  <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{app.company}</span>
                </div>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded flex-shrink-0"
                  style={{
                    color: STATUS_COLOR[app.status],
                    background: `color-mix(in srgb, ${STATUS_COLOR[app.status]} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${STATUS_COLOR[app.status]} 20%, transparent)`,
                  }}>
                  {t(app.status)}
                </span>
                <span className="text-[9px] flex-shrink-0 font-mono" style={{ color: 'var(--color-dim)' }}>
                  {new Date(app.updatedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>{t('no_apps')}</p>
        )}
      </div>
    </div>
  )
}
