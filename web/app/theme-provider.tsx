'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'jht-theme'
const DEFAULT_THEME: Theme = 'dark'

type ThemeCtx = { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void }
const ThemeContext = createContext<ThemeCtx>({ theme: DEFAULT_THEME, toggleTheme: () => {}, setTheme: () => {} })

export function useTheme() { return useContext(ThemeContext) }

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    const stored = (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) as Theme | null
    const resolved: Theme = stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME
    setThemeState(resolved)
    applyTheme(resolved)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    applyTheme(t)
    localStorage.setItem(STORAGE_KEY, t)
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

/** Bottone toggle tema — importabile in qualsiasi header/sidebar */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
      className={className}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: 'var(--color-muted)', padding: '4px 6px', borderRadius: 4 }}>
      {theme === 'dark' ? '☀' : '◐'}
    </button>
  )
}
