'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type NumberInputSize = 'sm' | 'md' | 'lg'

export interface NumberInputProps {
  value:       number
  onChange:    (value: number) => void
  min?:        number
  max?:        number
  step?:       number
  precision?:  number       // decimali, default 0
  prefix?:     string
  suffix?:     string
  label?:      string
  error?:      string
  disabled?:   boolean
  size?:       NumberInputSize
  fullWidth?:  boolean
  className?:  string
}

// ── Size maps ──────────────────────────────────────────────────────────────

const SIZE_CLS: Record<NumberInputSize, string> = {
  sm: 'text-[10px] py-1',
  md: 'text-[11px] py-2',
  lg: 'text-[12px] py-2.5',
}
const BTN_CLS: Record<NumberInputSize, string> = {
  sm: 'w-6 text-[12px]',
  md: 'w-8 text-[14px]',
  lg: 'w-9 text-[16px]',
}
const ADDON_CLS: Record<NumberInputSize, string> = {
  sm: 'px-1.5 text-[9px]',
  md: 'px-2 text-[10px]',
  lg: 'px-2.5 text-[11px]',
}

// ── Clamp + round ──────────────────────────────────────────────────────────

function clampRound(v: number, min: number | undefined, max: number | undefined, precision: number): number {
  const factor = Math.pow(10, precision)
  let result = Math.round(v * factor) / factor
  if (min !== undefined) result = Math.max(min, result)
  if (max !== undefined) result = Math.min(max, result)
  return result
}

// ── NumberInput ────────────────────────────────────────────────────────────

export function NumberInput({
  value, onChange, min, max, step = 1, precision = 0,
  prefix, suffix, label, error, disabled = false,
  size = 'md', fullWidth = false, className = '',
}: NumberInputProps) {
  const [raw, setRaw]   = useState(String(value))
  const holdRef         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync raw when value changes externally
  useEffect(() => { setRaw(String(value)) }, [value])

  const commit = useCallback((v: number) => {
    const clamped = clampRound(v, min, max, precision)
    setRaw(String(clamped))
    onChange(clamped)
  }, [min, max, precision, onChange])

  const increment = useCallback(() => commit(value + step), [commit, value, step])
  const decrement = useCallback(() => commit(value - step), [commit, value, step])

  // Hold to repeat with acceleration
  const startHold = (fn: () => void) => {
    fn()
    holdRef.current = setTimeout(() => {
      let speed = 150
      const tick = () => {
        fn()
        speed = Math.max(50, speed - 10)
        intervalRef.current = setTimeout(tick, speed)
      }
      tick()
    }, 400)
  }
  const stopHold = () => {
    if (holdRef.current)    clearTimeout(holdRef.current)
    if (intervalRef.current) clearTimeout(intervalRef.current)
  }

  useEffect(() => () => stopHold(), [])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp')   { e.preventDefault(); increment() }
    if (e.key === 'ArrowDown') { e.preventDefault(); decrement() }
  }

  const onBlur = () => {
    const parsed = parseFloat(raw)
    if (!isNaN(parsed)) commit(parsed)
    else setRaw(String(value))
  }

  const borderColor = error ? 'var(--color-red)' : 'var(--color-border)'
  const focusColor  = error ? 'var(--color-red)' : 'var(--color-green)'

  const stepBtn = (fn: () => void, label: string) => (
    <button
      type="button"
      onMouseDown={() => startHold(fn)}
      onMouseUp={stopHold} onMouseLeave={stopHold}
      onTouchStart={() => startHold(fn)} onTouchEnd={stopHold}
      disabled={disabled}
      aria-label={label}
      className={`flex items-center justify-center flex-shrink-0 font-mono font-bold cursor-pointer transition-colors select-none ${BTN_CLS[size]}`}
      style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: 'none', height: '100%' }}
    >
      {label === 'Decrementa' ? '−' : '+'}
    </button>
  )

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>
          {label}
        </label>
      )}

      <div className={`inline-flex items-stretch rounded overflow-hidden ${fullWidth ? 'w-full' : ''}`}
        style={{ border: `1px solid ${borderColor}`, transition: 'border-color 0.15s' }}
        onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = focusColor }}
        onBlurCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = borderColor }}>

        {stepBtn(decrement, 'Decrementa')}

        <div className="flex items-stretch flex-1 min-w-0" style={{ borderLeft: `1px solid ${borderColor}`, borderRight: `1px solid ${borderColor}` }}>
          {prefix && (
            <span className={`flex items-center flex-shrink-0 font-mono select-none ${ADDON_CLS[size]}`}
              style={{ background: 'var(--color-row)', color: 'var(--color-dim)', borderRight: `1px solid ${borderColor}` }}>
              {prefix}
            </span>
          )}
          <input
            type="text" inputMode="decimal"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKey}
            disabled={disabled}
            aria-label={label}
            className={`flex-1 min-w-0 text-center bg-[var(--color-card)] outline-none font-mono ${SIZE_CLS[size]} ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
            style={{ color: 'var(--color-bright)', border: 'none', padding: '0 6px' }}
          />
          {suffix && (
            <span className={`flex items-center flex-shrink-0 font-mono select-none ${ADDON_CLS[size]}`}
              style={{ background: 'var(--color-row)', color: 'var(--color-dim)', borderLeft: `1px solid ${borderColor}` }}>
              {suffix}
            </span>
          )}
        </div>

        {stepBtn(increment, 'Incrementa')}
      </div>

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
