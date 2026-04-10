'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import { isMarketingRoute } from '../marketing-routes'
import { useDashboardT } from './DashboardI18n'

const NotificationCenter = dynamic(() => import('./NotificationCenter').then(m => m.NotificationCenter))

// Maps url segment → i18n key (bc_*)
const SEG_KEY: Record<string, string> = {
  dashboard: 'bc_dashboard', agents: 'bc_agents', tasks: 'bc_tasks', assistant: 'bc_assistant',
  history: 'bc_history', sessions: 'bc_sessions', analytics: 'bc_analytics', queue: 'bc_queue',
  events: 'bc_events', notifications: 'bc_notifications', credentials: 'bc_credentials',
  plugins: 'bc_plugins', templates: 'bc_templates', logs: 'bc_logs', deploy: 'bc_deploy',
  providers: 'bc_providers', gateway: 'bc_gateway', memory: 'bc_memory', channels: 'bc_channels',
  settings: 'bc_settings', cron: 'bc_cron', config: 'bc_config', health: 'bc_health',
  overview: 'bc_overview', retry: 'bc_retry', tools: 'bc_tools',
  jobs: 'bc_jobs', applications: 'bc_applications', interviews: 'bc_interviews',
  companies: 'bc_companies', profiles: 'bc_profiles', alerts: 'bc_alerts',
  'cover-letters': 'bc_cover_letters', workers: 'bc_workers', status: 'bc_status',
  positions: 'bc_positions', ready: 'bc_ready', risposte: 'bc_risposte',
  crescita: 'bc_crescita', profile: 'bc_profile', team: 'bc_team',
  capitano: 'bc_capitano', scout: 'bc_scout', analista: 'bc_analista',
  scorer: 'bc_scorer', scrittore: 'bc_scrittore', critico: 'bc_critico',
  sentinella: 'bc_sentinella', assistente: 'bc_assistente',
  download: 'bc_download', guide: 'bc_guide', faq: 'bc_faq', about: 'bc_about',
  privacy: 'bc_privacy', changelog: 'bc_changelog', docs: 'bc_docs',
  stats: 'bc_stats', project: 'bc_project', reports: 'bc_reports', setup: 'bc_setup', edit: 'bc_edit',
  terms: 'bc_terms', achievements: 'bc_achievements', activity: 'bc_activity',
  archive: 'bc_archive', audit: 'bc_audit', automations: 'bc_automations', backup: 'bc_backup',
  bookmarks: 'bc_bookmarks', budget: 'bc_budget', calendar: 'bc_calendar', compare: 'bc_compare',
  contacts: 'bc_contacts', database: 'bc_database', errors: 'bc_errors', export: 'bc_export',
  feedback: 'bc_feedback', forum: 'bc_forum', git: 'bc_git', goals: 'bc_goals',
  import: 'bc_import', insights: 'bc_insights', integrations: 'bc_integrations',
  messages: 'bc_messages', monitoring: 'bc_monitoring', onboarding: 'bc_onboarding',
  performance: 'bc_performance', pipelines: 'bc_pipelines', recommendations: 'bc_recommendations',
  reminders: 'bc_reminders', scheduler: 'bc_scheduler', search: 'bc_search', secrets: 'bc_secrets',
  sentinel: 'bc_sentinel', skills: 'bc_skills', timeline: 'bc_timeline',
  validators: 'bc_validators', webhooks: 'bc_webhooks', metrics: 'bc_metrics',
}

const ID_RE = /^[0-9a-f-]{8,}$|^[A-Z][\w-]+$/

// ── Collapse dropdown ──────────────────────────────────────────────────────

type Crumb = { label: string; href: string; last: boolean }

function CollapseDropdown({ hidden }: { hidden: Crumb[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1">
      <span style={{ color: 'var(--color-border)' }}>/</span>
      <button onClick={() => setOpen(v => !v)}
        aria-label="Mostra percorso completo"
        aria-expanded={open}
        className="px-1.5 py-0.5 rounded text-[10px] transition-colors hover:opacity-80"
        style={{ background: 'var(--color-border)', color: 'var(--color-dim)', border: 'none', cursor: 'pointer' }}>
        ···
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 mt-1 rounded-lg overflow-hidden z-50 min-w-[140px]"
          style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {hidden.map(c => (
            <Link key={c.href} href={c.href} onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-[10px] no-underline hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </span>
  )
}

// ── Copy button ────────────────────────────────────────────────────────────

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }, [path])
  return (
    <button onClick={copy} title="Copia path" aria-label={copied ? 'Path copiato' : 'Copia path'}
      aria-live="polite"
      className="text-[9px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
      style={{ background: copied ? 'var(--color-green)18' : 'transparent', color: copied ? 'var(--color-green)' : 'var(--color-dim)', border: 'none', cursor: 'pointer' }}>
      {copied ? '✓' : '⎘'}
    </button>
  )
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────

const HIDDEN_PATHS = ['/setup']
const MAX_VISIBLE  = 3   // mostra max N segmenti, collassa il resto

export default function Breadcrumb() {
  const pathname = usePathname()
  const { t } = useDashboardT()

  if (!pathname || HIDDEN_PATHS.includes(pathname) || isMarketingRoute(pathname) || pathname.startsWith('/auth')) return null

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  function segLabel(seg: string): string {
    const key = SEG_KEY[seg]
    if (key) return t(key)
    if (ID_RE.test(seg)) return seg.length > 12 ? seg.slice(0, 8) + '…' : seg
    return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
  }

  const crumbs: Crumb[] = segments.map((seg, i) => ({
    label: segLabel(seg),
    href:  '/' + segments.slice(0, i + 1).join('/'),
    last:  i === segments.length - 1,
  }))

  // Collapse: first + hidden[] + last  (only when > MAX_VISIBLE)
  const needsCollapse = crumbs.length > MAX_VISIBLE
  const visible: (Crumb | 'collapse')[] = needsCollapse
    ? [crumbs[0], 'collapse', crumbs[crumbs.length - 1]]
    : crumbs
  const hidden = needsCollapse ? crumbs.slice(1, -1) : []

  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1 px-4 py-2 border-b text-[10px]"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-deep)', position: 'sticky', top: 0, zIndex: 40 }}>

      {/* Home icon */}
      <Link href="/dashboard" title="Dashboard" aria-label="Dashboard" className="no-underline transition-opacity hover:opacity-80 flex items-center"
        style={{ color: 'var(--color-dim)', fontSize: 12 }}><span aria-hidden="true">🏠</span></Link>

      {/* Crumbs */}
      {visible.map((item, i) => {
        if (item === 'collapse') return <CollapseDropdown key="collapse" hidden={hidden} />
        const crumb = item as Crumb
        return (
          <span key={crumb.href} className="flex items-center gap-1 min-w-0">
            <span style={{ color: 'var(--color-border)' }}>/</span>
            {crumb.last
              ? <span className="truncate max-w-[160px]" style={{ color: 'var(--color-muted)' }}>{crumb.label}</span>
              : <Link href={crumb.href} className="no-underline transition-opacity hover:opacity-80 truncate max-w-[120px] block"
                  style={{ color: 'var(--color-dim)' }}>{crumb.label}</Link>
            }
          </span>
        )
      })}

      {/* Copy + notifications */}
      <span className="ml-auto flex items-center gap-1">
        <CopyPath path={pathname} />
        <NotificationCenter />
      </span>
    </nav>
  )
}
