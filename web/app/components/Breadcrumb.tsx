'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import { NotificationCenter } from './NotificationCenter'

// ── Label map ──────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', agents: 'Agenti', tasks: 'Task', assistant: 'Assistente',
  history: 'Storico', sessions: 'Sessioni', analytics: 'Analytics', queue: 'Coda',
  events: 'Eventi', notifications: 'Notifiche', credentials: 'Credenziali',
  plugins: 'Plugin', templates: 'Template', logs: 'Log', deploy: 'Deploy',
  providers: 'Provider', gateway: 'Gateway', 'rate-limiter': 'Rate Limiter',
  memory: 'Memoria', channels: 'Canali', settings: 'Impostazioni', cron: 'Cron',
  config: 'Configurazione', daemon: 'Daemon', health: 'Salute', overview: 'Panoramica',
  retry: 'Retry', tools: 'Strumenti', 'not-found': '404',
  jobs: 'Offerte', applications: 'Candidature', interviews: 'Colloqui',
  companies: 'Aziende', profiles: 'Profili', alerts: 'Avvisi',
  'cover-letters': 'Cover Letter', workers: 'Workers', status: 'Stato',
  positions: 'Posizioni', ready: 'Pronte', risposte: 'Risposte',
  crescita: 'Crescita', profile: 'Profilo', team: 'Team',
  capitano: 'Capitano', scout: 'Scout', analista: 'Analista',
  scorer: 'Scorer', scrittore: 'Scrittore', critico: 'Critico',
  sentinella: 'Sentinella', assistente: 'Assistente',
  demo: 'Demo', download: 'Download', guide: 'Guida',
  faq: 'FAQ', about: 'Chi siamo', pricing: 'Pricing',
  privacy: 'Privacy', changelog: 'Changelog', docs: 'Documentazione',
  stats: 'Statistiche', reports: 'Report', setup: 'Setup', edit: 'Modifica',
  // Pagine aggiuntive
  achievements: 'Obiettivi', activity: 'Attività', 'ai-assistant': 'Assistente AI',
  'api-explorer': 'API Explorer', archive: 'Archivio', audit: 'Audit',
  automations: 'Automazioni', backup: 'Backup', bookmarks: 'Preferiti',
  budget: 'Budget', calendar: 'Calendario', compare: 'Confronto',
  contacts: 'Contatti', context: 'Contesto', database: 'Database',
  env: 'Ambiente', errors: 'Errori', export: 'Esportazione',
  feedback: 'Feedback', forum: 'Forum', git: 'Git', goals: 'Obiettivi',
  hooks: 'Hook', import: 'Importazione', insights: 'Insight',
  integrations: 'Integrazioni', map: 'Mappa', messages: 'Messaggi',
  migrations: 'Migrazioni', monitoring: 'Monitoraggio', networking: 'Networking',
  onboarding: 'Onboarding', performance: 'Performance', pipelines: 'Pipeline',
  recommendations: 'Raccomandazioni', reminders: 'Promemoria',
  'resume-builder': 'Crea CV', 'saved-searches': 'Ricerche Salvate',
  scheduler: 'Schedulatore', search: 'Ricerca', secrets: 'Segreti',
  sentinel: 'Sentinella', skills: 'Competenze', timeline: 'Timeline',
  validators: 'Validatori', webhooks: 'Webhook', metrics: 'Metriche',
}

const ID_RE = /^[0-9a-f-]{8,}$|^[A-Z][\w-]+$/

function segLabel(seg: string): string {
  if (LABELS[seg]) return LABELS[seg]
  if (ID_RE.test(seg)) return seg.length > 12 ? seg.slice(0, 8) + '…' : seg
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

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

const HIDDEN_PATHS = ['/', '/setup']
const MAX_VISIBLE  = 3   // mostra max N segmenti, collassa il resto

export default function Breadcrumb() {
  const pathname = usePathname()
  if (!pathname || HIDDEN_PATHS.includes(pathname) || pathname.startsWith('/auth')) return null

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

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
      <Link href="/dashboard" title="Dashboard" className="no-underline transition-opacity hover:opacity-80 flex items-center"
        style={{ color: 'var(--color-dim)', fontSize: 12 }}>🏠</Link>

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
