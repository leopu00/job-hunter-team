'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { CandidateProfile } from '@/lib/types'
import { openProfileAssistant } from '@/lib/profile-assistant-bus'
import { useLocale } from '@/lib/use-locale'
import { getProfileT } from '@/lib/profile-i18n'
import { weightedCompletion, isTeamUnlocked, completionByLevel } from '@/lib/profile-completion'

/* ── Completion calc ─────────────────────────────────────────────── */

// `tkey` è la chiave nel dizionario condiviso profile-i18n. `anchor` era il
// deep-link alla FormSection di /profile/edit (form rimosso): cliccando il
// chip del campo mancante ora si apre la chat dell'Assistente. Tenuto come
// label semantica del campo, non più usato come ancora.
type CompletionCheck = { ok: boolean; tkey: string; anchor: string }

function calcCompletionChecks(p: CandidateProfile | null): CompletionCheck[] {
  if (!p) return []
  return [
    { ok: !!p.name, tkey: 'f_name', anchor: 'info-base' },
    { ok: !!p.email, tkey: 'f_email', anchor: 'info-base' },
    { ok: !!p.target_role, tkey: 'f_target_role', anchor: 'info-base' },
    { ok: !!p.location, tkey: 'f_location', anchor: 'info-base' },
    { ok: p.experience_years != null, tkey: 'mf_exp_years', anchor: 'info-base' },
    { ok: !!(p.skills && Object.keys(p.skills).length > 0), tkey: 'sec_skills', anchor: 'skills' },
    { ok: !!(p.languages && p.languages.length > 0), tkey: 'sec_languages', anchor: 'lingue' },
    { ok: !!(p.job_titles && p.job_titles.length > 0), tkey: 'mf_desired_roles', anchor: 'ruoli-target' },
    { ok: !!(p.location_preferences && p.location_preferences.length > 0), tkey: 'mf_location_prefs', anchor: 'location-preferite' },
    { ok: p.salary_target != null, tkey: 'salary_target', anchor: 'salary-target' },
    { ok: !!(p.positioning?.contacts && Object.values(p.positioning.contacts).some(Boolean)), tkey: 'sec_contacts', anchor: 'contatti' },
    { ok: !!(p.positioning?.experience && (p.positioning.experience as unknown[]).length > 0), tkey: 'f_experience', anchor: 'esperienza-lavorativa' },
    { ok: !!(p.positioning?.education && (p.positioning.education as unknown[]).length > 0), tkey: 'mf_education', anchor: 'formazione' },
    { ok: !!(p.positioning?.career_goals && Object.values(p.positioning.career_goals).some(Boolean)), tkey: 'sec_career_goals', anchor: 'obiettivi-carriera' },
    { ok: !!(p.positioning?.strengths && (p.positioning.strengths as unknown[]).length > 0), tkey: 'sec_strengths', anchor: 'punti-di-forza' },
  ]
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

const LEVEL_ROWS = [
  { key: 'required' as const, baseColor: 'var(--color-red)' },
  { key: 'recommended' as const, baseColor: 'var(--color-yellow)' },
  { key: 'optional' as const, baseColor: 'var(--color-blue)' },
]

export default function ProfileStats({ profile }: Props) {
  const locale = useLocale()
  const t = getProfileT(locale)

  const completion = weightedCompletion(profile)
  const animatedCompletion = useAnimatedCount(completion)
  const missingFields = profile ? calcCompletionChecks(profile).filter(c => !c.ok) : []
  const teamUnlocked = isTeamUnlocked(profile)
  const levels = completionByLevel(profile)
  const requiredMissing = levels.required.missing.length

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
      setAvatarError(t('ps_avatar_error'))
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }, [locale])

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
              {t('ps_completion')}
            </div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: completion >= 80 ? 'var(--color-green)' : completion >= 50 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
                {animatedCompletion}%
              </span>
              {/* Gate: i campi REQUIRED sbloccano il team (tassonomia 3 livelli). */}
              <span
                className="mb-1 text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full border whitespace-nowrap"
                style={
                  teamUnlocked
                    ? { color: 'var(--color-green)', borderColor: 'var(--color-green)' }
                    : { color: 'var(--color-red)', borderColor: 'var(--color-red)' }
                }
              >
                {teamUnlocked ? '✓ team attivabile' : `${requiredMissing} obbligatori mancanti`}
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
            {/* Completezza per livello (tassonomia 3 livelli) */}
            {profile && (
              <div className="mt-3 flex flex-col gap-1.5">
                {LEVEL_ROWS.map(({ key, baseColor }) => {
                  const prog = levels[key]
                  const pct = prog.total ? Math.round((prog.filled / prog.total) * 100) : 0
                  const done = prog.filled === prog.total
                  const color = done ? 'var(--color-green)' : baseColor
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-[9px] mb-0.5">
                        <span className="uppercase tracking-[0.08em]" style={{ color }}>
                          {t(`ps_lvl_${key}`)}
                          {key === 'required' ? ` · ${t('ps_lvl_required_hint')}` : ''}
                        </span>
                        <span className="tabular-nums text-[var(--color-dim)]">{prog.filled}/{prog.total}</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-panel)' }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Missing fields tips ──────────────────────────────── */}
      {missingFields.length > 0 && missingFields.length <= 8 && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-[var(--color-yellow)]/20 bg-[var(--color-yellow)]/5">
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-yellow)] mb-2">
            {`${missingFields.length} ${t('mf_label')}`}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missingFields.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openProfileAssistant(`Vorrei aggiungere "${t(f.tkey)}" al mio profilo`)}
                title={`${t('go_to')} "${t(f.tkey)}"`}
                className="text-[10px] px-2 py-0.5 rounded border font-semibold no-underline transition-colors cursor-pointer hover:bg-[var(--color-yellow)]/15 hover:border-[var(--color-yellow)]/60"
                style={{ color: 'var(--color-yellow)', borderColor: 'var(--color-yellow)/30', background: 'var(--color-yellow)/8' }}
              >
                {t(f.tkey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CV Preview ──────────────────────────────────────────── */}
      {cvFiles.length > 0 && (
        <div className="mb-6 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">
            {t('ps_cv_preview')}
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
                    {t('ps_cv_open')}
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
          {t('ps_recent')}
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
                  {t(`status_${app.status}`)}
                </span>
                <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0 font-mono">
                  {new Date(app.updatedAt).toLocaleDateString(locale === 'it' ? 'it-IT' : locale, { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--color-dim)]">{t('ps_no_apps')}</p>
        )}
      </div>
    </div>
  )
}
