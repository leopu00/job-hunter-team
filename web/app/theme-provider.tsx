'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'jht-theme'

type ThemeCtx = { theme: Theme; resolvedTheme: 'dark' | 'light'; toggleTheme: () => void; setTheme: (t: Theme) => void }
const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', resolvedTheme: 'dark', toggleTheme: () => {}, setTheme: () => {} })

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
function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Risolve tema iniziale: stored → 'system' se niente salvato */
function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  return 'system'
}

function resolveActual(t: Theme): 'dark' | 'light' {
  if (t === 'system') return getSystemTheme()
  return t
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState]         = useState<Theme>('dark')
  const [resolvedTheme, setResolved]   = useState<'dark' | 'light'>('dark')

  // Init: legge localStorage, fallback system
  useEffect(() => {
    const t = resolveInitialTheme()
    const actual = resolveActual(t)
    setThemeState(t)
    setResolved(actual)
    applyTheme(actual)
  }, [])

  // Ascolta cambi di system preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const current = (localStorage.getItem(STORAGE_KEY) ?? 'system') as Theme
      if (current !== 'system') return
      const sys: 'dark' | 'light' = e.matches ? 'dark' : 'light'
      setResolved(sys)
      applyTheme(sys)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    enableTransition()
    const actual = resolveActual(t)
    setThemeState(t)
    setResolved(actual)
    applyTheme(actual)
    localStorage.setItem(STORAGE_KEY, t)
    fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => null)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/** Toggle animato con icone sun/moon */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
      aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
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
  const OPTIONS: { value: Theme; label: string }[] = [
    { value: 'dark',   label: '☀ dark'   },
    { value: 'light',  label: '◐ light'  },
    { value: 'system', label: '⊙ system' },
  ]
  return (
    <div className="flex items-center gap-2">
      {OPTIONS.map(({ value, label }) => (
        <button key={value} onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
          style={{
            border: `1px solid ${theme === value ? 'var(--color-green)' : 'var(--color-border)'}`,
            color: theme === value ? 'var(--color-green)' : 'var(--color-dim)',
            background: theme === value ? 'rgba(0,232,122,0.08)' : 'transparent',
          }}>
          {label}
        </button>
      ))}
    </div>
  )
}
