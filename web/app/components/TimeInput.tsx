'use client'

import { useId, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TimeValue { hours: number; minutes: number }

export interface TimeInputProps {
  value:        TimeValue | null
  onChange:     (v: TimeValue | null) => void
  format?:      '12h' | '24h'
  minuteStep?:  number           // default 1
  label?:       string
  error?:       string
  disabled?:    boolean
  placeholder?: string
  className?:   string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }

function clampH(h: number, is12: boolean) { return is12 ? Math.max(1, Math.min(12, h)) : Math.max(0, Math.min(23, h)) }
function clampM(m: number, step: number)  { return Math.max(0, Math.min(59, Math.round(m / step) * step)) }

function to12(h: number): { h12: number; ampm: 'AM' | 'PM' } {
  if (h === 0)  return { h12: 12, ampm: 'AM' }
  if (h < 12)   return { h12: h,  ampm: 'AM' }
  if (h === 12) return { h12: 12, ampm: 'PM' }
  return { h12: h - 12, ampm: 'PM' }
}

function from12(h12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return h12 === 12 ? 0 : h12
  return h12 === 12 ? 12 : h12 + 12
}

// ── Segment — singolo campo ore/minuti ─────────────────────────────────────

interface SegmentProps {
  value:    string
  min:      number
  max:      number
  step?:    number
  label:    string
  disabled: boolean
  focused:  boolean
  onFocus:  () => void
  onBlur:   () => void
  onChange: (raw: string) => void
  onStep:   (dir: 1 | -1) => void
}

function Segment({ value, label, disabled, focused, onFocus, onBlur, onChange, onStep }: SegmentProps) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <input
      ref={ref} type="text" inputMode="numeric" maxLength={2}
      value={value} aria-label={label} disabled={disabled}
      onFocus={onFocus} onBlur={onBlur}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'ArrowUp')   { e.preventDefault(); onStep(1) }
        if (e.key === 'ArrowDown') { e.preventDefault(); onStep(-1) }
      }}
      onClick={() => ref.current?.select()}
      className="outline-none bg-transparent font-mono text-center"
      style={{ width: 24, fontSize: 13, fontWeight: 700, border: 'none',
        color: focused ? 'var(--color-green)' : disabled ? 'var(--color-border)' : 'var(--color-bright)',
        caretColor: 'var(--color-green)', cursor: disabled ? 'not-allowed' : 'text' }}
    />
  )
}

// ── TimeInput ──────────────────────────────────────────────────────────────

export function TimeInput({
  value, onChange, format = '24h', minuteStep = 1,
  label, error, disabled = false, placeholder = '--:--', className = '',
}: TimeInputProps) {
  const id      = useId()
  const is12    = format === '12h'
  const border  = error ? 'var(--color-red)' : 'var(--color-border)'

  // Stato locale per editing
  const [hRaw, setHRaw] = useState(() => value ? pad(is12 ? to12(value.hours).h12 : value.hours) : '')
  const [mRaw, setMRaw] = useState(() => value ? pad(value.minutes) : '')
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(() => value ? to12(value.hours).ampm : 'AM')
  const [focH, setFocH] = useState(false)
  const [focM, setFocM] = useState(false)

  const emit = (h24: number, m: number) => onChange({ hours: h24, minutes: m })

  // Commit ore
  const commitH = (raw: string) => {
    const n = parseInt(raw, 10)
    if (isNaN(n)) { setHRaw(value ? pad(is12 ? to12(value.hours).h12 : value.hours) : ''); return }
    const clamped = clampH(n, is12)
    setHRaw(pad(clamped))
    const h24 = is12 ? from12(clamped, ampm) : clamped
    const m   = value?.minutes ?? 0
    emit(h24, m)
  }

  // Commit minuti
  const commitM = (raw: string) => {
    const n = parseInt(raw, 10)
    if (isNaN(n)) { setMRaw(value ? pad(value.minutes) : ''); return }
    const clamped = clampM(n, minuteStep)
    setMRaw(pad(clamped))
    const h24 = is12 ? from12(parseInt(hRaw, 10) || 0, ampm) : (parseInt(hRaw, 10) || 0)
    emit(h24, clamped)
  }

  const stepH = (dir: 1 | -1) => {
    const cur  = parseInt(hRaw, 10) || (is12 ? 12 : 0)
    const next = clampH(cur + dir, is12)
    setHRaw(pad(next))
    const h24  = is12 ? from12(next, ampm) : next
    emit(h24, value?.minutes ?? 0)
  }

  const stepM = (dir: 1 | -1) => {
    const cur  = parseInt(mRaw, 10) || 0
    const next = (cur + dir * minuteStep + 60) % 60
    setMRaw(pad(next))
    const h24  = is12 ? from12(parseInt(hRaw, 10) || 0, ampm) : (parseInt(hRaw, 10) || 0)
    emit(h24, next)
  }

  const toggleAmpm = () => {
    const next: 'AM' | 'PM' = ampm === 'AM' ? 'PM' : 'AM'
    setAmpm(next)
    if (value) emit(from12(parseInt(hRaw, 10) || 12, next), value.minutes)
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--color-muted)' }}>
          {label}
        </label>
      )}

      <div id={id} className="inline-flex items-center rounded"
        role="group" aria-label={label ?? 'Orario'}
        style={{ border: `1px solid ${(focH || focM) ? (error ? 'var(--color-red)' : 'var(--color-green)') : border}`,
          background: 'var(--color-card)', padding: '5px 10px', gap: 2,
          transition: 'border-color .15s', opacity: disabled ? 0.5 : 1 }}>

        <Segment value={hRaw || (value ? pad(is12 ? to12(value.hours).h12 : value.hours) : '')}
          min={is12 ? 1 : 0} max={is12 ? 12 : 23} label="Ore" disabled={disabled}
          focused={focH} onFocus={() => setFocH(true)} onBlur={() => { setFocH(false); commitH(hRaw) }}
          onChange={setHRaw} onStep={stepH} />

        <span style={{ color: 'var(--color-dim)', fontSize: 14, fontWeight: 700,
          lineHeight: 1, userSelect: 'none', padding: '0 1px' }}>:</span>

        <Segment value={mRaw || (value ? pad(value.minutes) : '')}
          min={0} max={59} step={minuteStep} label="Minuti" disabled={disabled}
          focused={focM} onFocus={() => setFocM(true)} onBlur={() => { setFocM(false); commitM(mRaw) }}
          onChange={setMRaw} onStep={stepM} />

        {is12 && (
          <button type="button" onClick={toggleAmpm} disabled={disabled}
            style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--color-row)', border: '1px solid var(--color-border)',
              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
              color: 'var(--color-muted)', transition: 'color .15s' }}>
            {ampm}
          </button>
        )}

        {!value && !focH && !focM && (
          <span style={{ position: 'absolute', pointerEvents: 'none', fontSize: 11,
            color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>
            {placeholder}
          </span>
        )}
      </div>

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
