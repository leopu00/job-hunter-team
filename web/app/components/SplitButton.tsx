'use client'

import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type SplitButtonVariant = 'primary' | 'secondary' | 'danger'

export interface SplitButtonOption {
  label:     string
  onClick:   () => void
  icon?:     string
  disabled?: boolean
  danger?:   boolean          // colore rosso per azioni distruttive
}

export interface SplitButtonProps {
  label:      string
  onClick:    () => void
  options:    SplitButtonOption[]
  variant?:   SplitButtonVariant
  loading?:   boolean
  disabled?:  boolean
  icon?:      string
  size?:      'sm' | 'md' | 'lg'
  className?: string
}

// ── Variant config ─────────────────────────────────────────────────────────

const V: Record<SplitButtonVariant, { bg: string; text: string; hover: string; border: string }> = {
  primary:   { bg: 'var(--color-green)',  text: '#000', hover: 'rgba(0,0,0,0.1)',   border: 'var(--color-green)'  },
  secondary: { bg: 'var(--color-card)',   text: 'var(--color-base)', hover: 'var(--color-row)', border: 'var(--color-border)' },
  danger:    { bg: 'var(--color-red)',    text: '#fff', hover: 'rgba(0,0,0,0.1)',   border: 'var(--color-red)'    },
}

const SZ = {
  sm: { h: 28, px: 10, font: 10, iconF: 11 },
  md: { h: 34, px: 14, font: 11, iconF: 13 },
  lg: { h: 40, px: 18, font: 12, iconF: 15 },
}

// ── Spinner ────────────────────────────────────────────────────────────────

const SPIN = `@keyframes sb-spin { to { transform: rotate(360deg) } }`

const Spinner = ({ color }: { color: string }) => (
  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
    border: `2px solid ${color}33`, borderTopColor: color, animation: 'sb-spin .7s linear infinite' }} />
)

// ── SplitButton ────────────────────────────────────────────────────────────

export function SplitButton({
  label, onClick, options, variant = 'primary', loading = false,
  disabled = false, icon, size = 'md', className = '',
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const v  = V[variant]
  const sz = SZ[size]
  const isDisabled = disabled || loading

  // Click esterno chiude
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const btnBase: React.CSSProperties = {
    height: sz.h, background: v.bg, color: v.text, border: 'none', cursor: isDisabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-mono)', fontSize: sz.font, fontWeight: 700, display: 'flex',
    alignItems: 'center', opacity: isDisabled ? 0.55 : 1, transition: 'opacity .15s, filter .15s',
  }

  return (
    <>
      <style>{SPIN}</style>
      <div ref={wrapRef} className={`relative inline-flex ${className}`}
        style={{ borderRadius: 6, overflow: 'visible',
          boxShadow: `0 0 0 1px ${v.border}`, filter: isDisabled ? 'none' : undefined }}>

        {/* Azione primaria */}
        <button type="button" onClick={isDisabled ? undefined : onClick}
          style={{ ...btnBase, padding: `0 ${sz.px}px`, gap: 6, borderRadius: '6px 0 0 6px',
            borderRight: `1px solid ${variant === 'secondary' ? 'var(--color-border)' : `${v.text}33`}` }}
          onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.12)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none' }}>
          {loading ? <Spinner color={v.text} /> : icon ? <span style={{ fontSize: sz.iconF }}>{icon}</span> : null}
          {label}
        </button>

        {/* Chevron trigger */}
        <button type="button"
          onClick={isDisabled ? undefined : () => setOpen(o => !o)}
          aria-haspopup="true" aria-expanded={open}
          style={{ ...btnBase, padding: `0 ${sz.px * 0.6}px`, borderRadius: '0 6px 6px 0' }}
          onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.12)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d={open ? 'M2 7l3-4 3 4' : 'M2 3l3 4 3-4'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Dropdown */}
        {open && (
          <div role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 160, zIndex: 50,
            background: 'var(--color-card)', border: '1px solid var(--color-border)',
            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
            animation: 'sb-in .15s ease' }}>
            <style>{`@keyframes sb-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }`}</style>
            {options.map((opt, i) => (
              <button key={i} type="button" role="menuitem" disabled={opt.disabled}
                onClick={() => { if (!opt.disabled) { opt.onClick(); setOpen(false) } }}
                className="w-full flex items-center gap-2 text-left"
                style={{ padding: `${sz.h * 0.25}px ${sz.px}px`, background: 'none', border: 'none',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)',
                  fontSize: sz.font, color: opt.danger ? 'var(--color-red)' : 'var(--color-base)',
                  opacity: opt.disabled ? 0.45 : 1, transition: 'background .1s' }}
                onMouseEnter={e => { if (!opt.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-row)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}>
                {opt.icon && <span style={{ fontSize: sz.iconF }}>{opt.icon}</span>}
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
