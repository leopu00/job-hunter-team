'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS = [
  {
    label: 'SISTEMA',
    links: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/deploy',    label: 'Deploy' },
      { href: '/gateway',   label: 'Gateway' },
    ],
  },
  {
    label: 'AGENTI',
    links: [
      { href: '/agents',    label: 'Agenti' },
      { href: '/assistant', label: 'Assistente' },
      { href: '/tasks',     label: 'Task' },
      { href: '/queue',     label: 'Queue' },
    ],
  },
  {
    label: 'DATI',
    links: [
      { href: '/events',    label: 'Events' },
      { href: '/history',   label: 'History' },
      { href: '/analytics', label: 'Analytics' },
      { href: '/logs',      label: 'Logs' },
    ],
  },
  {
    label: 'CONFIG',
    links: [
      { href: '/providers',    label: 'Provider' },
      { href: '/rate-limiter', label: 'Rate Limiter' },
      { href: '/credentials',  label: 'Credenziali' },
      { href: '/channels',     label: 'Canali' },
      { href: '/plugins',      label: 'Plugin' },
      { href: '/templates',    label: 'Template' },
      { href: '/memory',       label: 'Memory' },
      { href: '/notifications',label: 'Notifiche' },
      { href: '/settings',     label: 'Impostazioni' },
      { href: '/cron',         label: 'Cron' },
    ],
  },
]

// Pathname protetti (usano Navbar, non sidebar)
const PROTECTED_PREFIXES = [
  '/dashboard', '/profile', '/capitano', '/scout', '/analista',
  '/scorer', '/scrittore', '/critico', '/sentinella', '/team',
  '/applications', '/positions', '/ready', '/risposte', '/crescita',
  '/assistente', '/setup',
]

export default function Sidebar() {
  const pathname = usePathname()
  const isProtected = pathname === '/' || PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isProtected) return null

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col overflow-y-auto"
      style={{ width: 200, background: 'var(--color-deep)', borderRight: '1px solid var(--color-border)', zIndex: 50 }}>

      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-[11px] font-bold tracking-widest text-[var(--color-white)]">JHT</p>
        <p className="text-[9px] text-[var(--color-dim)]">Job Hunter Team</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: 'var(--color-dim)' }}>{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.links.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <li key={href}>
                    <Link href={href}
                      className="block px-2 py-1.5 rounded text-[11px] no-underline transition-colors"
                      style={{
                        color: active ? 'var(--color-green)' : 'var(--color-muted)',
                        background: active ? 'rgba(0,232,122,0.08)' : 'transparent',
                        borderLeft: active ? '2px solid var(--color-green)' : '2px solid transparent',
                      }}>
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
