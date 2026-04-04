'use client'

import { useEffect, useId, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface CurrencyInputProps {
  value:        number | null     // valore numerico puro (non formattato)
  onChange:     (v: number | null) => void
  currency?:    string            // codice ISO, default 'EUR'
  locale?:      string            // default 'it-IT'
  min?:         number
  max?:         number
  placeholder?: string
  label?:       string
  error?:       string
  disabled?:    boolean
  size?:        'sm' | 'md' | 'lg'
  fullWidth?:   boolean
  className?:   string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', CHF: 'Fr', JPY: '¥', CAD: 'CA$', AUD: 'A$',
}

function formatDisplay(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value)
}

function parseRaw(raw: string, locale: string): number | null {
  // Rimuove separatori migliaia e normalizza decimale
  const sample  = new Intl.NumberFormat(locale).format(1111.1)
  const thousand = sample[1]   // es. '.' in it-IT, ',' in en-US
  const decimal  = sample[5]   // es. ',' in it-IT, '.' in en-US
  const cleaned  = raw
    .replace(new RegExp(`\\${thousand}`, 'g'), '')
    .replace(new RegExp(`\\${decimal}`), '.')
    .replace(/[^\d.\-]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

const SIZE_CLS = { sm: 'text-[10px] py-1', md: 'text-[11px] py-2', lg: 'text-[12px] py-2.5' }
const SYM_CLS  = { sm: 'px-1.5 text-[9px]', md: 'px-2 text-[10px]', lg: 'px-2.5 text-[11px]' }

// ── CurrencyInput ──────────────────────────────────────────────────────────

export function CurrencyInput({
  value, onChange, currency = 'EUR', locale = 'it-IT',
  min, max, placeholder, label, error, disabled = false,
  size = 'md', fullWidth = false, className = '',
}: CurrencyInputProps) {
  const id        = useId()
  const inputRef  = useRef<HTMLInputElement>(null)
  const [raw, setRaw]       = useState(value != null ? formatDisplay(value, locale, currency) : '')
  const [editing, setEditing] = useState(false)

  // Sync quando value cambia esternamente
  useEffect(() => {
    if (!editing) setRaw(value != null ? formatDisplay(value, locale, currency) : '')
  }, [value, locale, currency, editing])

  const symbol    = SYMBOLS[currency] ?? currency
  const border    = error ? 'var(--color-red)' : 'var(--color-border)'
  const focusBorder = error ? 'var(--color-red)' : 'var(--color-green)'

  const onFocus = () => {
    setEditing(true)
    // In edit mode mostriamo il numero puro senza separatori
    if (value != null) setRaw(String(value))
  }

  const onBlur = () => {
    setEditing(false)
    const parsed = parseRaw(raw, locale)
    if (parsed === null) {
      onChange(null)
      setRaw('')
      return
    }
    const clamped = min != null && parsed < min ? min : max != null && parsed > max ? max : parsed
    onChange(clamped)
    setRaw(formatDisplay(clamped, locale, currency))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp'   && value != null) { e.preventDefault(); const v = Math.min((max ?? Infinity), value + 1); onChange(v); setRaw(String(v)) }
    if (e.key === 'ArrowDown' && value != null) { e.preventDefault(); const v = Math.max((min ?? -Infinity), value - 1); onChange(v); setRaw(String(v)) }
    if (e.key === 'Enter') inputRef.current?.blur()
  }

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label htmlFor={id} className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--color-muted)' }}>
          {label}
        </label>
      )}

      <div className={`inline-flex items-stretch rounded overflow-hidden ${fullWidth ? 'w-full' : ''}`}
        style={{ border: `1px solid ${border}`, transition: 'border-color .15s' }}
        onFocusCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = focusBorder }}
        onBlurCapture={e   => { (e.currentTarget as HTMLDivElement).style.borderColor = border }}>

        {/* Simbolo valuta */}
        <span className={`flex items-center flex-shrink-0 font-mono select-none ${SYM_CLS[size]}`}
          style={{ background: 'var(--color-row)', color: 'var(--color-dim)',
            borderRight: `1px solid ${border}` }}>
          {symbol}
        </span>

        {/* Input */}
        <input
          ref={inputRef} id={id}
          type="text" inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}
          placeholder={placeholder ?? (editing ? '0' : formatDisplay(0, locale, currency))}
          disabled={disabled}
          aria-label={label ?? `Importo in ${currency}`}
          aria-invalid={!!error}
          className={`flex-1 min-w-0 text-right bg-[var(--color-card)] outline-none font-mono ${SIZE_CLS[size]} ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
          style={{ color: 'var(--color-bright)', border: 'none', padding: '0 10px' }}
        />

        {/* Codice valuta */}
        <span className={`flex items-center flex-shrink-0 font-mono select-none ${SYM_CLS[size]}`}
          style={{ background: 'var(--color-row)', color: 'var(--color-dim)',
            borderLeft: `1px solid ${border}` }}>
          {currency}
        </span>
      </div>

      {/* Range hint */}
      {(min != null || max != null) && !error && (
        <span style={{ fontSize: 9, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>
          {min != null && max != null
            ? `${formatDisplay(min, locale, currency)} – ${formatDisplay(max, locale, currency)} ${currency}`
            : min != null ? `min. ${formatDisplay(min, locale, currency)} ${currency}`
            : `max. ${formatDisplay(max!, locale, currency)} ${currency}`}
        </span>
      )}

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
