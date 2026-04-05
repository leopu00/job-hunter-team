'use client'

import { useEffect, useRef, useState } from 'react'

// ── Country data ───────────────────────────────────────────────────────────

export interface Country { code: string; name: string; dial: string; flag: string }

export const COUNTRIES: Country[] = [
  { code: 'IT', name: 'Italia',          dial: '+39', flag: '🇮🇹' },
  { code: 'US', name: 'USA',             dial: '+1',  flag: '🇺🇸' },
  { code: 'GB', name: 'Regno Unito',     dial: '+44', flag: '🇬🇧' },
  { code: 'DE', name: 'Germania',        dial: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'Francia',         dial: '+33', flag: '🇫🇷' },
  { code: 'ES', name: 'Spagna',          dial: '+34', flag: '🇪🇸' },
  { code: 'PT', name: 'Portogallo',      dial: '+351',flag: '🇵🇹' },
  { code: 'NL', name: 'Olanda',          dial: '+31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgio',          dial: '+32', flag: '🇧🇪' },
  { code: 'CH', name: 'Svizzera',        dial: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria',         dial: '+43', flag: '🇦🇹' },
  { code: 'PL', name: 'Polonia',         dial: '+48', flag: '🇵🇱' },
  { code: 'SE', name: 'Svezia',          dial: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norvegia',        dial: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Danimarca',       dial: '+45', flag: '🇩🇰' },
  { code: 'CA', name: 'Canada',          dial: '+1',  flag: '🇨🇦' },
  { code: 'AU', name: 'Australia',       dial: '+61', flag: '🇦🇺' },
  { code: 'JP', name: 'Giappone',        dial: '+81', flag: '🇯🇵' },
  { code: 'CN', name: 'Cina',            dial: '+86', flag: '🇨🇳' },
  { code: 'IN', name: 'India',           dial: '+91', flag: '🇮🇳' },
  { code: 'BR', name: 'Brasile',         dial: '+55', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina',       dial: '+54', flag: '🇦🇷' },
  { code: 'MX', name: 'Messico',         dial: '+52', flag: '🇲🇽' },
  { code: 'RU', name: 'Russia',          dial: '+7',  flag: '🇷🇺' },
  { code: 'TR', name: 'Turchia',         dial: '+90', flag: '🇹🇷' },
  { code: 'AE', name: 'Emirati Arabi',   dial: '+971',flag: '🇦🇪' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length <= 3)  return d
  if (d.length <= 7)  return `${d.slice(0,3)} ${d.slice(3)}`
  return `${d.slice(0,3)} ${d.slice(3,7)} ${d.slice(7,12)}`
}

function isValid(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 7
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PhoneInputProps {
  value:          string
  onChange:       (v: string) => void
  defaultCountry?: string
  countries?:     Country[]
  showFlag?:      boolean
  searchable?:    boolean
  label?:         string
  error?:         string
  disabled?:      boolean
  className?:     string
}

// ── PhoneInput ─────────────────────────────────────────────────────────────

export function PhoneInput({
  value, onChange, defaultCountry = 'IT',
  countries = COUNTRIES, showFlag = true, searchable = true,
  label, error, disabled = false, className = '',
}: PhoneInputProps) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [country, setCountry] = useState<Country>(
    () => countries.find(c => c.code === defaultCountry) ?? countries[0]
  )
  const wrapRef = useRef<HTMLDivElement>(null)

  // Chiude dropdown su click esterno
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = query
    ? countries.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.dial.includes(query))
    : countries

  const select = (c: Country) => { setCountry(c); setOpen(false); setQuery('') }

  const borderColor = error ? 'var(--color-red)' : 'var(--color-border)'
  const full        = country.dial + ' ' + value

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} ref={wrapRef}>
      {label && (
        <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>
          {label}
        </span>
      )}

      <div className="flex items-stretch rounded overflow-visible"
        style={{ border: `1px solid ${borderColor}`, background: 'var(--color-card)', position: 'relative' }}
        onFocusCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = error ? 'var(--color-red)' : 'var(--color-green)' }}
        onBlurCapture={e   => { (e.currentTarget as HTMLDivElement).style.borderColor = borderColor }}>

        {/* Country picker */}
        <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-2 py-2 flex-shrink-0 cursor-pointer outline-none"
          style={{ background: 'var(--color-row)', border: 'none',
            borderRight: `1px solid ${borderColor}` }}>
          {showFlag && <span style={{ fontSize: 16, lineHeight: 1 }}>{country.flag}</span>}
          <span style={{ fontSize: 10, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>{country.dial}</span>
          <span style={{ fontSize: 8, color: 'var(--color-dim)' }}>▾</span>
        </button>

        {/* Number input */}
        <input type="tel" inputMode="tel" value={value} disabled={disabled}
          placeholder="320 1234 567"
          onChange={e => onChange(formatPhone(e.target.value))}
          className="flex-1 min-w-0 bg-transparent outline-none font-mono px-3 py-2 text-[11px]"
          style={{ color: 'var(--color-bright)', border: 'none' }}
          aria-label="Numero di telefono"
          aria-invalid={!!error}
          autoComplete="tel"
          title={full && isValid(value) ? `Numero completo: ${full}` : undefined}
        />

        {/* Valid check */}
        {value && (
          <span style={{ display: 'flex', alignItems: 'center', paddingRight: 8,
            color: isValid(value) ? 'var(--color-green)' : 'var(--color-dim)', fontSize: 11 }}>
            {isValid(value) ? '✓' : ''}
          </span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{ position: 'absolute', zIndex: 50, marginTop: 2, width: 240,
          background: 'var(--color-card)', border: '1px solid var(--color-border)',
          borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          {searchable && (
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Cerca paese..." className="w-full bg-transparent outline-none text-[10px] font-mono"
                style={{ color: 'var(--color-bright)', border: 'none' }} autoComplete="off" />
            </div>
          )}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.map(c => (
              <button key={c.code} type="button" onClick={() => select(c)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer"
                style={{ background: c.code === country.code ? 'var(--color-row)' : 'transparent',
                  border: 'none', transition: 'background .1s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-row)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = c.code === country.code ? 'var(--color-row)' : 'transparent' }}>
                <span style={{ fontSize: 14 }}>{c.flag}</span>
                <span style={{ fontSize: 10, color: 'var(--color-base)', fontFamily: 'var(--font-mono)', flex: 1 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>{c.dial}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p style={{ padding: '8px 12px', fontSize: 10, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>Nessun risultato</p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
