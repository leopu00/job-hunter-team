'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'jht-theme'

type ThemeCtx = { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void }
const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {}, setTheme: () => {} })

export function useTheme() { return useContext(ThemeContext) }

/** Inietta transizione temporanea — evita flash al caricamento ma anima il toggle */
function enableTransition() {
  const style = document.createElement('style')
  style.id = '__theme-transition'
  style.textContent = '*, *::before, *::after { transition: background-color 0.25s ease, border-color 0.25s ease, color 0.15s ease !important; }'
  document.head.appendChild(style)
  window.setTimeout(() => style.remove(), 300)
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Rileva preferenza di sistema */
function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Risolve tema iniziale: stored → system → dark */
function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored === 'dark' || stored === 'light') return stored
  return getSystemTheme()
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  // Init: legge localStorage o system preference
  useEffect(() => {
    const resolved = resolveInitialTheme()
    setThemeState(resolved)
    applyTheme(resolved)
  }, [])

  // Ascolta cambi di system preference (solo se nessuna preferenza salvata)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return // rispetta scelta utente
      const sys: Theme = e.matches ? 'dark' : 'light'
      setThemeState(sys)
      applyTheme(sys)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    enableTransition()
    setThemeState(t)
    applyTheme(t)
    localStorage.setItem(STORAGE_KEY, t)
    // Sync con UserPreferences API (fire-and-forget)
    fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => null)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/** Toggle animato con icone sun/moon */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
      className={className}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        lineHeight: 1, padding: '4px 6px', borderRadius: 4,
        color: isDark ? 'var(--color-yellow)' : 'var(--color-muted)',
        fontSize: 15, transition: 'transform 0.3s ease, color 0.2s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(20deg) scale(1.15)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'rotate(0deg) scale(1)' }}
    >
      {isDark ? '☀' : '◐'}
    </button>
  )
}

/** DarkModeToggle esteso — mostra testo + icona, usabile in settings */
export function DarkModeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex items-center gap-2">
      {(['dark', 'light'] as Theme[]).map(t => (
        <button key={t} onClick={() => setTheme(t)}
          className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
          style={{
            border: `1px solid ${theme === t ? 'var(--color-green)' : 'var(--color-border)'}`,
            color: theme === t ? 'var(--color-green)' : 'var(--color-dim)',
            background: theme === t ? 'rgba(0,232,122,0.08)' : 'transparent',
          }}>
          {t === 'dark' ? '☀ dark' : '◐ light'}
        </button>
      ))}
    </div>
  )
}
