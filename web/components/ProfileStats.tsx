'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { CandidateProfile } from '@/lib/types'

/* ── i18n inline ─────────────────────────────────────────────────── */

type Lang = 'it' | 'en'

const T: Record<string, Record<Lang, string>> = {
  completion:      { it: 'Completamento profilo', en: 'Profile completion' },
  match_avg:       { it: 'Match score medio', en: 'Average match score' },
  applications:    { it: 'Candidature', en: 'Applications' },
  recent:          { it: 'Ultime candidature', en: 'Recent applications' },
  no_apps:         { it: 'Nessuna candidatura ancora', en: 'No applications yet' },
  upload_avatar:   { it: 'Cambia foto', en: 'Change photo' },
  avatar_error:    { it: 'Errore nel caricamento', en: 'Upload error' },
  cv_preview:      { it: 'Anteprima CV', en: 'CV Preview' },
  cv_none:         { it: 'Nessun CV caricato', en: 'No CV uploaded' },
  cv_open:         { it: 'Apri documento', en: 'Open document' },
  sent:            { it: 'Inviate', en: 'Sent' },
  interview:       { it: 'Colloquio', en: 'Interview' },
  offer:           { it: 'Offerta', en: 'Offer' },
  rejected:        { it: 'Rifiutata', en: 'Rejected' },
  viewed:          { it: 'Vista', en: 'Viewed' },
  draft:           { it: 'Bozza', en: 'Draft' },
}

function useLang(): Lang {
  const [lang, setLang] = useState<Lang>('it')
  useEffect(() => {
    const stored = localStorage.getItem('jht-lang')
    if (stored === 'en') setLang('en')
  }, [])
  return lang
}

/* ── Completion calc ─────────────────────────────────────────────── */

type CompletionCheck = { ok: boolean; label: Record<Lang, string>; anchor: string }

// `anchor` punta all'id della FormSection corrispondente in /profile/edit.
// Cambiando un'ancora qui aggiorna anche il deep-link cliccando il chip
// del campo mancante.
function calcCompletionChecks(p: CandidateProfile | null): CompletionCheck[] {
  if (!p) return []
  return [
    { ok: !!p.name, label: { it: 'Nome', en: 'Name' }, anchor: 'info-base' },
    { ok: !!p.email, label: { it: 'Email', en: 'Email' }, anchor: 'info-base' },
    { ok: !!p.target_role, label: { it: 'Ruolo target', en: 'Target role' }, anchor: 'info-base' },
    { ok: !!p.location, label: { it: 'Location', en: 'Location' }, anchor: 'info-base' },
    { ok: p.experience_years != null, label: { it: 'Anni esperienza', en: 'Experience years' }, anchor: 'info-base' },
    { ok: !!(p.skills && Object.keys(p.skills).length > 0), label: { it: 'Skills', en: 'Skills' }, anchor: 'skills' },
    { ok: !!(p.languages && p.languages.length > 0), label: { it: 'Lingue', en: 'Languages' }, anchor: 'lingue' },
    { ok: !!(p.job_titles && p.job_titles.length > 0), label: { it: 'Ruoli desiderati', en: 'Desired roles' }, anchor: 'ruoli-target' },
    { ok: !!(p.location_preferences && p.location_preferences.length > 0), label: { it: 'Preferenze sede', en: 'Location prefs' }, anchor: 'location-preferite' },
    { ok: p.salary_target != null, label: { it: 'Salary target', en: 'Salary target' }, anchor: 'salary-target' },
    { ok: !!(p.positioning?.contacts && Object.values(p.positioning.contacts).some(Boolean)), label: { it: 'Contatti', en: 'Contacts' }, anchor: 'contatti' },
    { ok: !!(p.positioning?.experience && (p.positioning.experience as unknown[]).length > 0), label: { it: 'Esperienza', en: 'Experience' }, anchor: 'esperienza-lavorativa' },
    { ok: !!(p.positioning?.education && (p.positioning.education as unknown[]).length > 0), label: { it: 'Formazione', en: 'Education' }, anchor: 'formazione' },
    { ok: !!(p.positioning?.career_goals && Object.values(p.positioning.career_goals).some(Boolean)), label: { it: 'Obiettivi carriera', en: 'Career goals' }, anchor: 'obiettivi-carriera' },
    { ok: !!(p.positioning?.strengths && (p.positioning.strengths as unknown[]).length > 0), label: { it: 'Punti di forza', en: 'Strengths' }, anchor: 'punti-di-forza' },
  ]
}

function calcCompletion(p: CandidateProfile | null): number {
  if (!p) return 0
  const checks = calcCompletionChecks(p)
  const filled = checks.filter(c => c.ok).length
  return Math.round((filled / checks.length) * 100)
}

/* ── Animated counter hook ────────────────────────────────────────── */

function useAnimatedCount(target: number, duration = 800): number {
  const [count, setCount] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (target === 0) { setCount(0); return }
    startRef.current = null
    let raf: number
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setCount(Math.round(eased * target))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return count
}

/* ── Types ────────────────────────────────────────────────────────── */

type AppStatus = 'draft' | 'sent' | 'viewed' | 'interview' | 'offer' | 'rejected'
type MiniApp = { id: string; jobTitle: string; company: string; status: AppStatus; updatedAt: number }

const STATUS_COLOR: Record<AppStatus, string> = {
  draft:     'var(--color-dim)',
  sent:      'var(--color-blue)',
  viewed:    'var(--color-yellow)',
  interview: 'var(--color-green)',
  offer:     'var(--color-green)',
  rejected:  'var(--color-red)',
}

/* ── Component ────────────────────────────────────────────────────── */

interface Props {
  profile: CandidateProfile | null
}

export default function ProfileStats({ profile }: Props) {
  const lang = useLang()
  const t = (k: string) => T[k]?.[lang] ?? k

  const completion = calcCompletion(profile)
  const animatedCompletion = useAnimatedCount(completion)
  const missingFields = profile ? calcCompletionChecks(profile).filter(c => !c.ok) : []

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)

  // Applications
  const [apps, setApps] = useState<MiniApp[]>([])
  const [appCounts, setAppCounts] = useState<Record<string, number>>({})

  // CV files
  const [cvFiles, setCvFiles] = useState<{ name: string; size: number }[]>([])

  // Fetch avatar
  useEffect(() => {
    fetch('/api/profile/avatar')
      .then(r => { if (r.ok && r.status !== 204) return r.blob(); return null })
      .then(b => { if (b) setAvatarUrl(URL.createObjectURL(b)) })
      .catch(() => {})
  }, [])

  // Fetch applications
  useEffect(() => {
    fetch('/api/applications')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.applications)) setApps(data.applications.slice(0, 5))
        if (data.counts) setAppCounts(data.counts)
      })
      .catch(() => {})
  }, [])

  // Fetch CV files
  useEffect(() => {
    fetch('/api/profile/files')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.files)) {
          setCvFiles(data.files.filter((f: { name: string }) =>
            /\.(pdf|doc|docx|txt|md)$/i.test(f.name)
          ))
        }
      })
      .catch(() => {})
  }, [])

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    setAvatarError(null)
    const fd = new FormData()
    fd.append('avatar', file)
    try {
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) {
        setAvatarError(data.error ?? 'Errore')
      } else {
        // Refresh avatar
        const r2 = await fetch('/api/profile/avatar')
        if (r2.ok && r2.status !== 204) {
          const blob = await r2.blob()
          setAvatarUrl(URL.createObjectURL(blob))
        }
      }
    } catch {
      setAvatarError(t('avatar_error'))
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }, [lang])

  const totalApps = Object.values(appCounts).reduce((s, n) => s + n, 0)

  // Fake avg match score based on profile completion + app data
  const avgMatch = totalApps > 0
    ? Math.min(99, Math.round(completion * 0.6 + (appCounts['interview'] ?? 0) * 8 + (appCounts['offer'] ?? 0) * 12 + 15))
    : null

  const initials = profile?.name
    ? profile.name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  return (
    <div className="mb-8" style={{ animation: 'fade-in 0.3s ease both' }}>
      {/* ── Top: Avatar + Stats ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-6 items-start mb-6">
        {/* Avatar */}
        <div className="relative flex-shrink-0 group">
          <div
            className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
            style={{
              background: avatarUrl ? 'transparent' : 'var(--color-green)/15',
              border: '2px solid var(--color-green)',
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold" style={{ color: 'var(--color-green)' }}>
                {initials}
              </span>
            )}
          </div>
          <button
            onClick={() => avatarRef.current?.click()}
            className="absolute inset-0 w-20 h-20 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)', cursor: 'pointer', border: 'none' }}
            disabled={avatarUploading}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          <input
            ref={avatarRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
          {avatarUploading && (
            <div className="absolute inset-0 w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <span className="text-[var(--color-green)] animate-pulse text-sm">...</span>
            </div>
          )}
          {avatarError && (
            <p className="absolute -bottom-5 left-0 text-[9px] text-[var(--color-red)] whitespace-nowrap">{avatarError}</p>
          )}
        </div>

        {/* Name + Stats cards */}
        <div className="flex-1 min-w-0">
          {profile?.name && (
            <h2 className="text-lg font-bold text-[var(--color-white)] mb-1 truncate" title={profile.name}>{profile.name}</h2>
          )}
          {profile?.target_role && (
            <p className="text-[11px] text-[var(--color-muted)] mb-4">{profile.target_role} {profile.location ? `· ${profile.location}` : ''}</p>
          )}

          {/* Completion — unica stat utile sul profilo. Match score medio e
              conteggio candidature appartengono alla dashboard, non al
              profilo. */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-2">
              {t('completion')}
            </div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: completion >= 80 ? 'var(--color-green)' : completion >= 50 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
                {animatedCompletion}%
              </span>
            </div>
            <div role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} aria-label="Completamento profilo" className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-panel)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${completion}%`,
                  background: completion >= 80 ? 'var(--color-green)' : completion >= 50 ? 'var(--color-yellow)' : 'var(--color-red)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Missing fields tips ──────────────────────────────── */}
      {missingFields.length > 0 && missingFields.length <= 8 && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-[var(--color-yellow)]/20 bg-[var(--color-yellow)]/5">
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-yellow)] mb-2">
            {lang === 'it' ? `${missingFields.length} campi mancanti` : `${missingFields.length} missing fields`}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missingFields.map((f, i) => (
              <Link
                key={i}
                href={`/profile#${f.anchor}`}
                title={lang === 'it' ? `Vai a "${f.label.it}"` : `Go to "${f.label.en}"`}
                className="text-[10px] px-2 py-0.5 rounded border font-semibold no-underline transition-colors hover:bg-[var(--color-yellow)]/15 hover:border-[var(--color-yellow)]/60"
                style={{ color: 'var(--color-yellow)', borderColor: 'var(--color-yellow)/30', background: 'var(--color-yellow)/8' }}
              >
                {f.label[lang]}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── CV Preview ──────────────────────────────────────────── */}
      {cvFiles.length > 0 && (
        <div className="mb-6 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">
            {t('cv_preview')}
          </div>
          <div className="flex flex-col gap-2">
            {cvFiles.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-blue)', flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[11px] text-[var(--color-bright)] flex-1 truncate font-semibold">{f.name}</span>
                <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">
                  {f.size < 1024 ? `${f.size} B` : f.size < 1024 * 1024 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                </span>
                {/\.pdf$/i.test(f.name) && (
                  <a
                    href={`/api/profile/files/${encodeURIComponent(f.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] font-semibold text-[var(--color-blue)] hover:underline no-underline flex-shrink-0"
                  >
                    {t('cv_open')}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Storico candidature ─────────────────────────────────── */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">
          {t('recent')}
        </div>
        {apps.length > 0 ? (
          <div className="flex flex-col gap-2">
            {apps.map(app => (
              <div key={app.id} className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: STATUS_COLOR[app.status] }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-semibold text-[var(--color-bright)] truncate block">{app.jobTitle}</span>
                  <span className="text-[10px] text-[var(--color-muted)]">{app.company}</span>
                </div>
                <span
                  className="text-[9px] font-semibold px-2 py-0.5 rounded flex-shrink-0"
                  style={{
                    color: STATUS_COLOR[app.status],
                    background: `color-mix(in srgb, ${STATUS_COLOR[app.status]} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${STATUS_COLOR[app.status]} 20%, transparent)`,
                  }}
                >
                  {t(app.status)}
                </span>
                <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0 font-mono">
                  {new Date(app.updatedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--color-dim)]">{t('no_apps')}</p>
        )}
      </div>
    </div>
  )
}
