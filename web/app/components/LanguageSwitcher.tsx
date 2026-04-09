'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl';
import { localeLabels, type Locale } from '../../i18n/config';

type LocaleInfo = { code: string; label: string; flag: string }

export default function LanguageSwitcher() {
  const t = useTranslations('language');
  const currentLocale = useLocale() as Locale;
  const [current, setCurrent] = useState(currentLocale)
  const [locales, setLocales] = useState<LocaleInfo[]>([])
  const [open, setOpen] = useState(false)

  const fetchLocale = useCallback(async () => {
    console.log('[LanguageSwitcher] Fetching locales...')
    const res = await fetch('/api/i18n?t=' + Date.now()).catch((err) => {
      console.log('[LanguageSwitcher] Fetch error:', err)
      return null
    })
    if (!res?.ok) {
      console.log('[LanguageSwitcher] Response not OK:', res?.status)
      return
    }
    const data = await res.json()
    console.log('[LanguageSwitcher] Received data:', data)
    console.log('[LanguageSwitcher] Locales count:', data.locales?.length)
    console.log('[LanguageSwitcher] Locales:', data.locales)
    setCurrent(data.current ?? currentLocale)
    setLocales(data.locales ?? [])
  }, [currentLocale])

  useEffect(() => { fetchLocale() }, [fetchLocale])

  const switchLocale = async (code: string) => {
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

  const currentInfo = locales.find(l => l.code === current) || { 
    code: current, 
    label: localeLabels[current]?.label || 'English', 
    flag: localeLabels[current]?.flag || 'EN' 
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={t('switch', { language: currentInfo.label })}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 px-3 py-1.5 rounded transition-colors cursor-pointer w-full"
        style={{ background: open ? 'var(--color-row)' : 'transparent', border: '1px solid var(--color-border)' }}>
        <span className="text-[10px] font-bold tracking-wide" style={{ color: 'var(--color-muted)' }}>
          {currentInfo.flag}
        </span>
        <span className="text-[10px] text-[var(--color-dim)] flex-1 text-left">{currentInfo.label}</span>
        <span className="text-[8px] text-[var(--color-dim)]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div role="listbox" aria-label={t('select')} className="absolute bottom-full left-0 mb-1 w-full rounded overflow-hidden shadow-lg"
          style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', zIndex: 100 }}>
          {locales.map(l => (
            <button key={l.code} role="option" aria-selected={l.code === current} onClick={() => switchLocale(l.code)}
              className="flex items-center gap-2 px-3 py-2 w-full transition-colors cursor-pointer text-left"
              style={{
                background: l.code === current ? 'rgba(0,232,122,0.08)' : 'transparent',
                color: l.code === current ? 'var(--color-green)' : 'var(--color-muted)',
              }}>
              <span className="text-[10px] font-bold tracking-wide">{l.flag}</span>
              <span className="text-[10px]">{l.label}</span>
              {l.code === current && <span className="text-[8px] ml-auto" style={{ color: 'var(--color-green)' }}>&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
