'use client'

import { useEffect, useId, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface OTPInputProps {
  length?:      number           // default 6
  value:        string
  onChange:     (v: string) => void
  autoFocus?:   boolean
  type?:        'number' | 'alphanumeric'
  disabled?:    boolean
  error?:       boolean
  label?:       string
  className?:   string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sanitize(v: string, type: 'number' | 'alphanumeric'): string {
  return type === 'number' ? v.replace(/\D/g, '') : v.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

// ── OTPInput ───────────────────────────────────────────────────────────────

export function OTPInput({
  length = 6, value, onChange, autoFocus = false,
  type = 'number', disabled = false, error = false,
  label, className = '',
}: OTPInputProps) {
  const id          = useId()
  const refs        = useRef<(HTMLInputElement | null)[]>([])
  const [focused, setFocused] = useState<number | null>(autoFocus ? 0 : null)

  // Mantieni array refs allineato a length
  useEffect(() => { refs.current = refs.current.slice(0, length) }, [length])

  // autoFocus iniziale
  useEffect(() => { if (autoFocus) refs.current[0]?.focus() }, [autoFocus])

  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  const set = (idx: number, char: string) => {
    const arr = digits.slice()
    arr[idx]  = char
    onChange(arr.join(''))
  }

  const focus = (idx: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, idx))]
    el?.focus()
  }

  const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[idx]) {
        set(idx, '')
      } else if (idx > 0) {
        set(idx - 1, '')
        focus(idx - 1)
      }
    } else if (e.key === 'ArrowLeft')  { e.preventDefault(); focus(idx - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); focus(idx + 1) }
      else if (e.key === 'Delete')     { e.preventDefault(); set(idx, '') }
  }

  const onInput = (idx: number, raw: string) => {
    const clean = sanitize(raw, type)
    if (!clean) return
    // Potrebbe essere un singolo char (normale) — gestito da onPaste per stringhe lunghe
    const char = clean[clean.length - 1]
    set(idx, char)
    if (idx < length - 1) focus(idx + 1)
  }

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const raw   = sanitize(e.clipboardData.getData('text'), type)
    const chars = raw.slice(0, length).split('')
    const arr   = digits.slice()
    chars.forEach((c, i) => { arr[i] = c })
    onChange(arr.join(''))
    // Sposta focus all'ultimo inserito o all'ultimo slot
    const nextFocus = Math.min(chars.length, length - 1)
    focus(nextFocus)
  }

  const borderActive  = error ? 'var(--color-red)' : 'var(--color-green)'
  const borderDefault = error ? 'var(--color-red)' : 'var(--color-border)'

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label htmlFor={`${id}-0`} className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--color-muted)' }}>
          {label}
        </label>
      )}

      <div className="flex items-center gap-2" role="group" aria-label={label ?? 'Codice OTP'}>
        {digits.map((digit, i) => (
          <input
            key={i}
            id={i === 0 ? `${id}-0` : undefined}
            ref={el => { refs.current[i] = el }}
            type={type === 'number' ? 'tel' : 'text'}
            inputMode={type === 'number' ? 'numeric' : 'text'}
            pattern={type === 'number' ? '[0-9]*' : '[A-Za-z0-9]*'}
            maxLength={2}          /* 2 per catturare il nuovo char senza svuotare */
            value={digit}
            disabled={disabled}
            autoComplete="one-time-code"
            aria-label={`Cifra ${i + 1} di ${length}`}
            onFocus={() => setFocused(i)}
            onBlur={() => setFocused(null)}
            onChange={e => onInput(i, e.target.value)}
            onKeyDown={e => onKeyDown(i, e)}
            onPaste={onPaste}
            onClick={() => refs.current[i]?.select()}
            className="text-center font-mono font-bold outline-none rounded transition-all"
            style={{
              width: 40, height: 48, fontSize: 20,
              background: 'var(--color-card)',
              border: `2px solid ${focused === i ? borderActive : digit ? borderActive : borderDefault}`,
              color: error ? 'var(--color-red)' : 'var(--color-bright)',
              boxShadow: focused === i ? `0 0 0 3px color-mix(in srgb, ${borderActive} 15%, transparent)` : 'none',
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? 'not-allowed' : 'text',
            }}
          />
        ))}
      </div>

      {error && (
        <p className="text-[10px]" style={{ color: 'var(--color-red)', fontFamily: 'var(--font-mono)' }}>
          Codice non valido
        </p>
      )}
    </div>
  )
}
