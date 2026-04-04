'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotificationCenter } from './NotificationCenter'

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', agents: 'Agenti', tasks: 'Task', assistant: 'Assistente',
  history: 'History', sessions: 'Sessioni', analytics: 'Analytics', queue: 'Queue',
  events: 'Events', notifications: 'Notifiche', credentials: 'Credenziali',
  plugins: 'Plugin', templates: 'Template', logs: 'Log', deploy: 'Deploy',
  providers: 'Provider', gateway: 'Gateway', 'rate-limiter': 'Rate Limiter',
  memory: 'Memory', channels: 'Canali', settings: 'Impostazioni', cron: 'Cron',
  config: 'Config', daemon: 'Daemon', health: 'Health', overview: 'Overview',
  retry: 'Retry', tools: 'Tool', 'not-found': '404',
}

const ID_PATTERN = /^[0-9a-f-]{8,}$|^[A-Z][\w-]+$/

function segmentLabel(seg: string): string {
  if (LABELS[seg]) return LABELS[seg]
  if (ID_PATTERN.test(seg)) return seg.length > 16 ? seg.slice(0, 8) + '…' : seg
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

const HIDDEN_PREFIXES = ['/', '/setup']

export default function Breadcrumb() {
  const pathname = usePathname()
  if (!pathname || HIDDEN_PREFIXES.includes(pathname) || pathname.startsWith('/auth')) return null

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const crumbs = segments.map((seg, i) => ({
    label: segmentLabel(seg),
    href:  '/' + segments.slice(0, i + 1).join('/'),
    last:  i === segments.length - 1,
  }))

  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1 px-5 py-2 border-b text-[10px]"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-deep)', position: 'sticky', top: 0, zIndex: 40 }}>
      <Link href="/dashboard" className="no-underline transition-colors" style={{ color: 'var(--color-dim)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-muted)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>⌂</Link>
      {crumbs.map(crumb => (
        <span key={crumb.href} className="flex items-center gap-1">
          <span style={{ color: 'var(--color-border)' }}>/</span>
          {crumb.last
            ? <span style={{ color: 'var(--color-muted)' }}>{crumb.label}</span>
            : <Link href={crumb.href} className="no-underline transition-colors" style={{ color: 'var(--color-dim)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-muted)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>{crumb.label}</Link>
          }
        </span>
      ))}
      <span className="ml-auto"><NotificationCenter /></span>
    </nav>
  )
}
