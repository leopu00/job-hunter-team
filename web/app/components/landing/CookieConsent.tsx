'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'jht:cookie-consent'
const LANG_KEY = 'jht-lang'

const T = {
  it: {
    text: 'Questo sito utilizza cookie tecnici per il funzionamento e cookie analitici per migliorare la tua esperienza.',
    accept: 'Accetta',
    decline: 'Solo necessari',
    privacy: 'Privacy Policy',
  },
  en: {
    text: 'This site uses technical cookies for functionality and analytics cookies to improve your experience.',
    accept: 'Accept',
    decline: 'Necessary only',
    privacy: 'Privacy Policy',
  },
}

function getLang(): 'it' | 'en' {
  if (typeof window === 'undefined') return 'it'
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'en') return 'en'
  const browser = navigator.language.slice(0, 2)
  if (browser === 'en') return 'en'
  return 'it'
}

export default function CookieConsent() {
  const [lang, setLang] = useState<'it' | 'en'>('it')
  const t = T[lang]
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setLang(getLang())
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch { /* SSR / privacy mode */ }
  }, [])

  const respond = (choice: 'accepted' | 'necessary') => {
    try { localStorage.setItem(STORAGE_KEY, choice) } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[9980] flex justify-center"
      style={{ animation: 'fade-in 0.3s ease both', animationDelay: '1s', animationFillMode: 'both' }}
    >
      <div
        role="dialog"
        aria-label="Cookie consent"
        className="w-full max-w-xl rounded-xl px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
        style={{
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {t.text}{' '}
            <Link href="/privacy" className="no-underline transition-colors hover:opacity-80"
              style={{ color: 'var(--color-green)' }}>
              {t.privacy}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => respond('necessary')}
            className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-80"
            style={{
              background: 'transparent',
              color: 'var(--color-dim)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
            }}
          >
            {t.decline}
          </button>
          <button
            onClick={() => respond('accepted')}
            className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-90"
            style={{
              background: 'var(--color-green)',
              color: '#000',
              border: '1px solid var(--color-green)',
              cursor: 'pointer',
            }}
          >
            {t.accept}
          </button>
        </div>
      </div>
    </div>
  )
}
