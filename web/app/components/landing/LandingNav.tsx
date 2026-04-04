'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useLandingI18n, type Lang } from './LandingI18n'

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

const LANGUAGES: { code: Lang; label: string; Flag: () => React.JSX.Element }[] = [
  { code: 'it', label: 'Italiano', Flag: FlagIT },
  { code: 'en', label: 'English', Flag: FlagEN },
]

function LangDropdown() {
  const { lang, setLang } = useLandingI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const current = LANGUAGES.find(l => l.code === lang)!

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all"
        style={{
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          cursor: 'pointer',
        }}
      >
        <current.Flag />
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : '' }}>
          <path d="M2 4L5 7L8 4" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 rounded-lg overflow-hidden"
          style={{
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            animation: 'fade-in 0.15s ease both',
            minWidth: 140,
          }}
        >
          {LANGUAGES.map(({ code, label, Flag }) => (
            <button
              key={code}
              onClick={() => { setLang(code); setOpen(false) }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors"
              style={{
                cursor: 'pointer',
                background: code === lang ? 'var(--color-card)' : 'transparent',
                color: code === lang ? 'var(--color-white)' : 'var(--color-muted)',
                fontSize: 11,
                fontWeight: code === lang ? 600 : 400,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Flag />
              <span>{label}</span>
              {code === lang && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto">
                  <path d="M2 5L4 7L8 3" stroke="var(--color-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LandingNav() {
  const { t } = useLandingI18n()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: 'linear-gradient(180deg, var(--color-void) 60%, transparent)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-between px-5 sm:px-6 py-4">
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
          <Link href="/guide" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            Guida
          </Link>
          <Link href="/faq" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            FAQ
          </Link>
          <Link href="/pricing" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            Pricing
          </Link>
          <Link href="/demo" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_demo')}
          </Link>
          <Link href="/about" className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            About
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <LangDropdown />

          <Link
            href="/?login=true"
            className="hidden sm:inline-flex px-4 py-2 rounded text-[11px] font-semibold tracking-wider no-underline transition-all"
            style={{
              border: '1px solid var(--color-green)',
              color: 'var(--color-green)',
            }}
          >
            {t('nav_login')}
          </Link>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="md:hidden flex flex-col gap-1 p-1.5 rounded"
            style={{ background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer' }}
            aria-label="Menu"
          >
            <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', transform: mobileOpen ? 'rotate(45deg) translate(2px, 2px)' : '' }} />
            <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', opacity: mobileOpen ? 0 : 1 }} />
            <span className="block w-4 h-0.5 rounded-full" style={{ background: 'var(--color-muted)', transition: 'all 0.2s', transform: mobileOpen ? 'rotate(-45deg) translate(2px, -2px)' : '' }} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div
          className="md:hidden px-5 pb-4 flex flex-col gap-3"
          style={{ background: 'var(--color-void)', animation: 'fade-in 0.15s ease both' }}
        >
          <a href="#features" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_features')}
          </a>
          <a href="#how" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_how')}
          </a>
          <a href="https://github.com/leopu00/job-hunter-team" target="_blank" rel="noreferrer"
            className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_github')}
          </a>
          <Link href="/download" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_download')}
          </Link>
          <Link href="/guide" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            Guida
          </Link>
          <Link href="/faq" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            FAQ
          </Link>
          <Link href="/pricing" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            Pricing
          </Link>
          <Link href="/demo" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            {t('nav_demo')}
          </Link>
          <Link href="/about" onClick={() => setMobileOpen(false)} className="text-[12px] py-2 text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline">
            About
          </Link>
          <Link
            href="/?login=true"
            onClick={() => setMobileOpen(false)}
            className="text-center py-2.5 rounded text-[12px] font-semibold tracking-wider no-underline transition-all"
            style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)' }}
          >
            {t('nav_login')}
          </Link>
        </div>
      )}
    </nav>
  )
}
