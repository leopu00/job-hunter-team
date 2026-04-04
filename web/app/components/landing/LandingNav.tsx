'use client'

import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

function FlagIT() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2 }}>
      <rect width="7" height="14" fill="#009246" />
      <rect x="7" width="6" height="14" fill="#fff" />
      <rect x="13" width="7" height="14" fill="#CE2B37" />
    </svg>
  )
}

function FlagEN() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2 }}>
      <rect width="20" height="14" fill="#012169" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" strokeWidth="2.5" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M10,0 V14 M0,7 H20" stroke="#fff" strokeWidth="4" />
      <path d="M10,0 V14 M0,7 H20" stroke="#C8102E" strokeWidth="2.5" />
    </svg>
  )
}

export default function LandingNav() {
  const { lang, toggle, t } = useLandingI18n()

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
          {t('nav_features')}
        </a>
        <a href="#how" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
          {t('nav_how')}
        </a>
        <a
          href="https://github.com/leopu00/job-hunter-team"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
        >
          {t('nav_github')}
        </a>
        <Link href="/download" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
          {t('nav_download')}
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="flex items-center justify-center w-8 h-8 rounded transition-all"
          style={{
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
          }}
          title={lang === 'it' ? 'Switch to English' : 'Passa all\'italiano'}
        >
          {lang === 'it' ? <FlagIT /> : <FlagEN />}
        </button>

        <Link
          href="/?login=true"
          className="px-4 py-2 rounded text-[11px] font-semibold tracking-wider no-underline transition-all"
          style={{
            border: '1px solid var(--color-green)',
            color: 'var(--color-green)',
          }}
        >
          {t('nav_login')}
        </Link>
      </div>
    </nav>
  )
}
