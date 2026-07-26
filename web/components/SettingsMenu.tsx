'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { DarkModeToggle } from '@/app/theme-provider'
import { useLocale } from '@/lib/use-locale'
import { makeT } from "@/lib/i18n-dict";
import { T } from "./SettingsMenu.i18n";

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
  const ref = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const tr = makeT(T, locale);

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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={tr('settings')}
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
            {tr('settings')}
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-bright)' }}>
              {tr('theme')}
            </span>
            <DarkModeToggle />
          </div>

          {/* Voci placeholder — riabilitare una alla volta dopo validazione.
              <SectionHeader>Notifiche</SectionHeader>
              <MenuLink href="/notifications" onClick={() => setOpen(false)}>Preferenze notifiche</MenuLink>
              <MenuLink href="/channels" onClick={() => setOpen(false)}>Canali</MenuLink>
              <MenuLink href="/integrations" onClick={() => setOpen(false)}>Integrazioni</MenuLink>

              <SectionHeader>Sistema</SectionHeader>
              <MenuLink href="/cron" onClick={() => setOpen(false)}>Cron jobs</MenuLink>
              <MenuLink href="/setup" onClick={() => setOpen(false)}>Setup wizard</MenuLink>
              <MenuLink href="/settings/cloud-sync" onClick={() => setOpen(false)}>Cloud sync</MenuLink>
              <MenuLink href="/cli-link" onClick={() => setOpen(false)}>Collega CLI / VPS</MenuLink>
          */}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 pt-3 pb-1 text-[9px] font-semibold tracking-widest uppercase"
      style={{ color: 'var(--color-dim)', borderTop: '1px solid var(--color-border)' }}
    >
      {children}
    </div>
  )
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="block px-3 py-1.5 text-[11px] hover:bg-[var(--color-card)] transition-colors no-underline"
      style={{ color: 'var(--color-muted)' }}
    >
      {children}
    </Link>
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

