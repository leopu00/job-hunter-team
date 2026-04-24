'use client'

import { useEffect, useRef, useState } from 'react'

const DEV_MODE_KEY = 'jht-dev-mode'
const DEV_MODE_EVENT = 'jht-dev-mode-change'

export function readDevMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(DEV_MODE_KEY) === '1'
}

/** Hook: restituisce lo stato dev mode, aggiornato live quando l'utente
 *  lo toggla via SettingsMenu. Parte a `false` (stesso valore server-side)
 *  per evitare mismatch di hydration, poi si allinea al localStorage. */
export function useDevMode(): boolean {
  const [dev, setDev] = useState(false)
  useEffect(() => {
    setDev(readDevMode())
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<boolean>
      setDev(typeof ce.detail === 'boolean' ? ce.detail : readDevMode())
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_MODE_KEY) setDev(e.newValue === '1')
    }
    window.addEventListener(DEV_MODE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(DEV_MODE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return dev
}

export default function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Leggi lo stato iniziale dopo il mount (niente mismatch SSR/CSR).
  useEffect(() => { setDevMode(readDevMode()) }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleDev = () => {
    const next = !devMode
    setDevMode(next)
    window.localStorage.setItem(DEV_MODE_KEY, next ? '1' : '0')
    window.dispatchEvent(new CustomEvent(DEV_MODE_EVENT, { detail: next }))
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Impostazioni"
        className="flex items-center justify-center w-8 h-8 rounded hover:bg-[var(--color-card)] transition-colors"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
      >
        <GearIcon />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 220,
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <div className="px-3 py-2 text-[9px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-dim)', borderBottom: '1px solid var(--color-border)' }}>
            Impostazioni
          </div>
          <button
            role="menuitemcheckbox"
            aria-checked={devMode}
            onClick={toggleDev}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--color-card)] transition-colors"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          >
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-bright)' }}>
              Modalità dev
            </span>
            <Toggle on={devMode} />
          </button>
        </div>
      )}
    </div>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 28,
        height: 16,
        borderRadius: 8,
        background: on ? 'rgba(34,197,94,0.3)' : 'var(--color-border)',
        border: `1px solid ${on ? 'rgba(34,197,94,0.5)' : 'var(--color-border)'}`,
        transition: 'background 0.15s, border-color 0.15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: on ? 13 : 1,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: on ? '#22c55e' : 'var(--color-muted)',
          boxShadow: on ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
          transition: 'left 0.15s, background 0.15s',
        }}
      />
    </span>
  )
}
