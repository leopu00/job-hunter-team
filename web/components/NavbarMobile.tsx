'use client'

import Link from 'next/link'
import { useState } from 'react'

const NAV_ITEMS: { href: string; label: string; accent?: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/positions', label: 'Posizioni' },
  { href: '/applications', label: 'Candidature' },
  { href: '/ready', label: 'Pronte', accent: '#7fffb2' },
  { href: '/risposte', label: 'Risposte', accent: '#58a6ff' },
  { href: '/crescita', label: 'Crescita' },
  { href: '/team', label: 'Team' },
  { href: '/profile', label: 'Profilo' },
]

export default function NavbarMobile() {
  const [open, setOpen] = useState(false)

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
          {NAV_ITEMS.map(({ href, label, accent }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="px-5 py-3 text-[12px] font-semibold tracking-wide no-underline border-b border-[var(--color-border)] last:border-b-0 transition-colors hover:bg-[var(--color-card)]"
              style={{ color: accent ?? 'var(--color-muted)' }}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
