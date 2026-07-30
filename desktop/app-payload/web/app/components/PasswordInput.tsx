'use client'

import { useState, useId } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PasswordRequirement {
  label:   string
  test:    (v: string) => boolean
}

export interface PasswordInputProps {
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
  label?:       string
  error?:       string
  disabled?:    boolean
  showStrength?: boolean
  requirements?: PasswordRequirement[]
  className?:   string
}

// ── Preset requirements ────────────────────────────────────────────────────

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: 'Almeno 8 caratteri',        test: v => v.length >= 8           },
  { label: 'Una lettera maiuscola',      test: v => /[A-Z]/.test(v)        },
  { label: 'Un numero',                  test: v => /[0-9]/.test(v)        },
  { label: 'Un carattere speciale',      test: v => /[^A-Za-z0-9]/.test(v) },
]

// ── Strength ───────────────────────────────────────────────────────────────

function calcStrength(v: string, reqs: PasswordRequirement[]): 0 | 1 | 2 | 3 {
  if (!v) return 0
  const passed = reqs.filter(r => r.test(v)).length
  const ratio  = passed / reqs.length
  if (ratio <= 0.25) return 1
  if (ratio <= 0.75) return 2
  return 3
}

const STRENGTH_MAP = {
  0: { label: '',        color: 'var(--color-border)', w: '0%'    },
  1: { label: 'Debole',  color: 'var(--color-red)',    w: '33%'   },
  2: { label: 'Media',   color: 'var(--color-orange)', w: '66%'   },
  3: { label: 'Forte',   color: 'var(--color-green)',  w: '100%'  },
} as const

// ── Eye icons ──────────────────────────────────────────────────────────────

const EyeOpen = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const EyeOff = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

// ── CheckIcon ──────────────────────────────────────────────────────────────

const Check = ({ ok }: { ok: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    {ok
      ? <><circle cx="6" cy="6" r="5" fill="var(--color-green)" opacity=".15"/><path d="M3 6l2 2 4-4" stroke="var(--color-green)" strokeWidth="1.5" strokeLinecap="round"/></>
      : <circle cx="6" cy="6" r="5" stroke="var(--color-border)" strokeWidth="1.5"/>}
  </svg>
)

// ── PasswordInput ──────────────────────────────────────────────────────────

export function PasswordInput({
  value, onChange, placeholder = '••••••••',
  label, error, disabled = false,
  showStrength = false, requirements = PASSWORD_REQUIREMENTS,
  className = '',
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  const borderColor = error ? 'var(--color-red)' : 'var(--color-border)'
  const strength    = calcStrength(value, requirements)
  const sm          = STRENGTH_MAP[strength]

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--color-muted)' }}>
          {label}
        </label>
      )}

      {/* Input row */}
      <div className="flex items-center rounded overflow-hidden"
        style={{ border: `1px solid ${borderColor}`, background: 'var(--color-card)', transition: 'border-color .15s' }}
        onFocusCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = error ? 'var(--color-red)' : 'var(--color-green)' }}
        onBlurCapture={e   => { (e.currentTarget as HTMLDivElement).style.borderColor = borderColor }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="current-password"
          className="flex-1 min-w-0 bg-transparent outline-none text-[11px] font-mono px-3 py-2"
          style={{ color: 'var(--color-bright)', border: 'none' }}
        />
        <button type="button" onClick={() => setVisible(v => !v)} disabled={disabled}
          style={{ padding: '0 10px', background: 'none', border: 'none', cursor: 'pointer',
            color: visible ? 'var(--color-green)' : 'var(--color-dim)', transition: 'color .15s' }}
          aria-label={visible ? 'Nascondi password' : 'Mostra password'}>
          {visible ? <EyeOff /> : <EyeOpen />}
        </button>
      </div>

      {/* Strength bar */}
      {showStrength && value && (
        <div className="flex flex-col gap-1">
          <div style={{ height: 3, background: 'var(--color-row)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: sm.w, background: sm.color, borderRadius: 99, transition: 'width .3s ease, background .3s ease' }} />
          </div>
          {sm.label && <span style={{ fontSize: 9, color: sm.color, fontFamily: 'var(--font-mono)' }}>{sm.label}</span>}
        </div>
      )}

      {/* Requirements checklist */}
      {requirements.length > 0 && value && (
        <div className="flex flex-col gap-1 mt-0.5">
          {requirements.map((r, i) => {
            const ok = r.test(value)
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Check ok={ok} />
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)',
                  color: ok ? 'var(--color-green)' : 'var(--color-dim)', transition: 'color .2s' }}>
                  {r.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
