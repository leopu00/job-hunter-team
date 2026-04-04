'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import LanguageSwitcher from './LanguageSwitcher'
import { ThemeToggle } from '../theme-provider'

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
      { href: '/providers',     label: 'Provider' },
      { href: '/rate-limiter',  label: 'Rate Limiter' },
      { href: '/credentials',   label: 'Credenziali' },
      { href: '/channels',      label: 'Canali' },
      { href: '/plugins',       label: 'Plugin' },
      { href: '/templates',     label: 'Template' },
      { href: '/memory',        label: 'Memory' },
      { href: '/notifications', label: 'Notifiche' },
      { href: '/settings',      label: 'Impostazioni' },
      { href: '/cron',          label: 'Cron' },
    ],
  },
]

const PROTECTED_PREFIXES = [
  '/dashboard', '/profile', '/capitano', '/scout', '/analista',
  '/scorer', '/scrittore', '/critico', '/sentinella', '/team',
  '/applications', '/positions', '/ready', '/risposte', '/crescita',
  '/assistente', '/setup',
]

export default function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const isProtected = pathname === '/' || PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Chiudi drawer al cambio pagina
  useEffect(() => { setMobileOpen(false) }, [pathname])

  if (isProtected) return null

  const sidebarContent = (
    <aside
      aria-label="sidebar"
      className="flex flex-col overflow-y-auto h-full"
      style={{ width: 200, background: 'var(--color-deep)', borderRight: '1px solid var(--color-border)' }}>
      <div className="px-5 py-5 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <p className="text-[11px] font-bold tracking-widest text-[var(--color-white)]">JHT</p>
          <p className="text-[9px] text-[var(--color-dim)]">Job Hunter Team</p>
        </div>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', fontSize: 18 }}>×</button>
        )}
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: 'var(--color-dim)' }}>{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.links.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? 'page' : undefined}
                      className="block px-2 py-1.5 rounded text-[11px] no-underline transition-colors"
                      style={{ color: active ? 'var(--color-green)' : 'var(--color-muted)', background: active ? 'rgba(0,232,122,0.08)' : 'transparent', borderLeft: active ? '2px solid var(--color-green)' : '2px solid transparent' }}>
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-3 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </aside>
  )

  if (isMobile) return (
    <>
      {/* Hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Apri menu"
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 60, background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1 }}>
        ☰
      </button>
      {/* Overlay */}
      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 55, animation: 'fade-in 0.15s ease both' }} />
          <div style={{ position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 60, animation: 'fade-in 0.2s ease both' }}>
            {sidebarContent}
          </div>
        </>
      )}
    </>
  )

  return (
    <div style={{ position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 50 }}>
      {sidebarContent}
    </div>
  )
}
