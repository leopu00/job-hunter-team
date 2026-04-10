'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { localeLabels, type Locale } from '../../i18n/config'

type LocaleInfo = { code: Locale; label: string; flag: string }

function FlagIT() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="7" height="14" fill="#009246" />
      <rect x="7" width="6" height="14" fill="#fff" />
      <rect x="13" width="7" height="14" fill="#CE2B37" />
    </svg>
  )
}

function FlagEN() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="14" fill="#012169" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" strokeWidth="2.5" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M10,0 V14 M0,7 H20" stroke="#fff" strokeWidth="4" />
      <path d="M10,0 V14 M0,7 H20" stroke="#C8102E" strokeWidth="2.5" />
    </svg>
  )
}

function FlagHU() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="4.67" fill="#CD2A3E" />
      <rect y="4.67" width="20" height="4.66" fill="#fff" />
      <rect y="9.33" width="20" height="4.67" fill="#436F4D" />
    </svg>
  )
}

const FLAGS: Record<string, () => React.JSX.Element> = { it: FlagIT, en: FlagEN, hu: FlagHU }

export default function LanguageSwitcher({ direction = 'up' }: { direction?: 'up' | 'down' }) {
  const [current, setCurrent] = useState<Locale>('it')
  const [locales, setLocales] = useState<LocaleInfo[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchLocale = useCallback(async () => {
    const res = await fetch('/api/i18n?t=' + Date.now()).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setCurrent(data.current ?? 'it')
    setLocales(data.locales ?? [])
  }, [])

  useEffect(() => { fetchLocale() }, [fetchLocale])

  const switchLocale = async (code: Locale) => {
    setOpen(false)
    if (code === current) return
    const res = await fetch('/api/i18n', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: code }),
    }).catch(() => null)
    if (res?.ok) {
      setCurrent(code)
      window.location.reload()
    }
  }

  const CurrentFlag = FLAGS[current] || FlagEN

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 py-0 px-0 transition-all cursor-pointer"
        aria-label={`Language: ${localeLabels[current]?.label || current}`}
        aria-expanded={open}
      >
        <CurrentFlag />
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : '' }}>
          <path d="M2 4L5 7L8 4" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} overflow-hidden`}
          style={{
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 100,
            minWidth: 140,
          }}
        >
          {locales.map(l => {
            const Flag = FLAGS[l.code] || FlagEN
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={l.code === current}
                onClick={() => switchLocale(l.code)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors cursor-pointer"
                style={{
                  background: l.code === current ? 'var(--color-card)' : 'transparent',
                  color: l.code === current ? 'var(--color-white)' : 'var(--color-muted)',
                  fontSize: 11,
                  fontWeight: l.code === current ? 600 : 400,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <Flag />
                <span>{l.label}</span>
                {l.code === current && (
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto">
                    <path d="M2 5L4 7L8 3" stroke="var(--color-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
