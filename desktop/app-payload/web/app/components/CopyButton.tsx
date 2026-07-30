'use client'

import { useState, useCallback, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type CopyState = 'idle' | 'copied' | 'error'

export interface CopyButtonProps {
  text:              string
  children?:         React.ReactNode
  successDuration?:  number       // ms, default 2000
  variant?:          'default' | 'inline' | 'ghost'
  size?:             'sm' | 'md' | 'lg'
  label?:            string       // aria-label override
  className?:        string
}

// ── Icons ──────────────────────────────────────────────────────────────────

function ClipboardIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-3" />
    </svg>
  )
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Size maps ──────────────────────────────────────────────────────────────

const ICON_PX: Record<string, number>  = { sm: 12, md: 14, lg: 16 }
const BTN_CLS: Record<string, string>  = {
  sm: 'text-[9px] px-2 py-1 gap-1 rounded',
  md: 'text-[10px] px-3 py-1.5 gap-1.5 rounded-md',
  lg: 'text-[11px] px-4 py-2 gap-2 rounded-lg',
}
const INLINE_CLS: Record<string, string> = {
  sm: 'w-5 h-5 rounded',
  md: 'w-6 h-6 rounded',
  lg: 'w-7 h-7 rounded-md',
}

// ── useCopy hook ───────────────────────────────────────────────────────────

export function useCopy(successDuration = 2000) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async (text: string) => {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('error')
    }
    timer.current = setTimeout(() => setState('idle'), successDuration)
  }, [successDuration])

  return { state, copy }
}

// ── CopyButton ─────────────────────────────────────────────────────────────

export function CopyButton({
  text, children, successDuration = 2000,
  variant = 'default', size = 'md', label, className = '',
}: CopyButtonProps) {
  const { state, copy } = useCopy(successDuration)
  const iconPx = ICON_PX[size]

  const stateColor = state === 'copied' ? 'var(--color-green)' : state === 'error' ? 'var(--color-red)' : undefined

  const baseStyle: React.CSSProperties = variant === 'inline'
    ? { background: 'transparent', border: 'none', color: stateColor ?? 'var(--color-dim)' }
    : variant === 'ghost'
    ? { background: 'transparent', border: '1px solid transparent', color: stateColor ?? 'var(--color-muted)' }
    : { background: 'var(--color-row)', border: '1px solid var(--color-border)', color: stateColor ?? 'var(--color-muted)' }

  const hoverCls = variant === 'inline'
    ? 'hover:text-[var(--color-bright)]'
    : 'hover:border-[var(--color-muted)]'

  if (variant === 'inline') {
    return (
      <button
        onClick={() => copy(text)}
        aria-label={label ?? (state === 'copied' ? 'Copiato!' : 'Copia')}
        className={`inline-flex items-center justify-center cursor-pointer transition-colors ${INLINE_CLS[size]} ${hoverCls} ${className}`}
        style={{ ...baseStyle, padding: 0 }}
      >
        {state === 'copied' ? <CheckIcon size={iconPx} />
          : state === 'error' ? <ErrorIcon size={iconPx} />
          : <ClipboardIcon size={iconPx} />}
      </button>
    )
  }

  return (
    <button
      onClick={() => copy(text)}
      aria-label={label ?? (state === 'copied' ? 'Copiato!' : 'Copia')}
      className={`inline-flex items-center font-semibold cursor-pointer transition-all select-none ${BTN_CLS[size]} ${hoverCls} ${className}`}
      style={baseStyle}
    >
      {state === 'copied' ? <CheckIcon size={iconPx} />
        : state === 'error' ? <ErrorIcon size={iconPx} />
        : <ClipboardIcon size={iconPx} />}
      {children
        ? <span>{children}</span>
        : <span>{state === 'copied' ? 'Copiato!' : state === 'error' ? 'Errore' : 'Copia'}</span>}
    </button>
  )
}

// ── CopyField — input readonly con CopyButton integrato ────────────────────

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>{label}</p>}
      <div className="flex items-center rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <input readOnly value={value} className="flex-1 px-3 py-2 text-[11px] font-mono bg-[var(--color-card)] outline-none truncate"
          style={{ color: 'var(--color-bright)', border: 'none' }} />
        <div className="flex-shrink-0 px-2" style={{ borderLeft: '1px solid var(--color-border)', background: 'var(--color-row)' }}>
          <CopyButton text={value} variant="inline" size="md" />
        </div>
      </div>
    </div>
  )
}
