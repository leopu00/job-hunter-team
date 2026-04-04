'use client'

import Link from 'next/link'

export default function LandingNav() {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
      style={{
        background: 'linear-gradient(180deg, var(--color-void) 60%, transparent)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: 'var(--color-green)', boxShadow: '0 0 8px var(--color-green)' }}
        />
        <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)]">
          JHT
        </span>
      </Link>

      <div className="hidden md:flex items-center gap-6">
        <a href="#features" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
          Features
        </a>
        <a href="#how" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
          Come funziona
        </a>
        <a href="#cta" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
          Inizia
        </a>
      </div>

      <Link
        href="/?login=true"
        className="px-4 py-2 rounded text-[11px] font-semibold tracking-wider no-underline transition-all"
        style={{
          border: '1px solid var(--color-green)',
          color: 'var(--color-green)',
        }}
      >
        Accedi
      </Link>
    </nav>
  )
}
