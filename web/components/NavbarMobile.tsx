'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useDashboardT } from '@/app/components/DashboardI18n'

const NAV_KEYS: { href: string; key: string; accent?: string }[] = [
  { href: '/dashboard',    key: 'nav_dashboard' },
  { href: '/positions',    key: 'nav_positions' },
  { href: '/applications', key: 'nav_applications' },
  { href: '/ready',        key: 'nav_ready',    accent: '#7fffb2' },
  { href: '/risposte',     key: 'nav_risposte', accent: '#58a6ff' },
  { href: '/crescita',     key: 'nav_crescita' },
  { href: '/reports',      key: 'nav_reports' },
  { href: '/team',         key: 'nav_team' },
  { href: '/profile',      key: 'nav_profile' },
  { href: '/credentials',  key: 'nav_settings', accent: '#8b949e' },
]

export default function NavbarMobile() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { t } = useDashboardT()

  return (
    <div className="md:hidden flex items-center">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex flex-col gap-1 p-1.5 rounded"
        style={{ background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer' }}
        aria-label="Menu navigazione"
        aria-expanded={open}
        aria-controls="app-mobile-nav"
      >
        <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', transform: open ? 'rotate(45deg) translate(2px, 2px)' : '' }} />
        <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', opacity: open ? 0 : 1 }} />
        <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', transform: open ? 'rotate(-45deg) translate(2px, -2px)' : '' }} />
      </button>

      {open && (
        <div
          id="app-mobile-nav"
          role="menu"
          className="absolute top-full left-0 right-0 flex flex-col border-b border-[var(--color-border)]"
          style={{ background: 'var(--color-panel)', animation: 'fade-in 0.15s ease both', zIndex: 50 }}
        >
          {NAV_KEYS.map(({ href, key, accent }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
            <Link
              key={href}
              href={href}
              role="menuitem"
              aria-current={active ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className="px-5 py-3 text-[12px] font-semibold tracking-wide no-underline border-b border-[var(--color-border)] last:border-b-0 transition-colors hover:bg-[var(--color-card)]"
              style={{ color: active ? 'var(--color-green)' : accent ?? 'var(--color-muted)' }}
            >
              {t(key)}
            </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
