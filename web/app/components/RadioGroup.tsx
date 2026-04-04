'use client'

import { useId } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type RadioSize = 'sm' | 'md' | 'lg'

export interface RadioOption {
  value:        string
  label:        string
  description?: string
  disabled?:    boolean
}

export interface RadioGroupProps {
  options:      RadioOption[]
  value:        string
  onChange:     (value: string) => void
  name?:        string
  label?:       string
  orientation?: 'vertical' | 'horizontal'
  size?:        RadioSize
  error?:       string
  className?:   string
}

// ── Size maps ──────────────────────────────────────────────────────────────

const OUTER_PX: Record<RadioSize, number> = { sm: 14, md: 16, lg: 20 }
const INNER_PX: Record<RadioSize, number> = { sm: 6,  md: 7,  lg: 9  }
const LABEL_CLS: Record<RadioSize, string> = { sm: 'text-[10px]', md: 'text-[11px]', lg: 'text-[12px]' }
const DESC_CLS:  Record<RadioSize, string> = { sm: 'text-[9px]',  md: 'text-[10px]', lg: 'text-[11px]' }

// ── RadioItem ──────────────────────────────────────────────────────────────

interface RadioItemProps {
  option:   RadioOption
  checked:  boolean
  name:     string
  size:     RadioSize
  onChange: (value: string) => void
}

function RadioItem({ option, checked, name, size, onChange }: RadioItemProps) {
  const itemId  = useId()
  const outerPx = OUTER_PX[size]
  const innerPx = INNER_PX[size]
  const disabled = option.disabled ?? false

  return (
    <label
      htmlFor={itemId}
      className={`flex items-start gap-2 ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* Hidden native input */}
      <input
        id={itemId}
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(option.value)}
        aria-checked={checked}
        className="sr-only"
      />

      {/* Custom circle */}
      <span
        className="flex items-center justify-center flex-shrink-0 rounded-full transition-all"
        style={{
          width: outerPx, height: outerPx, marginTop: 1,
          background: checked ? 'color-mix(in srgb, var(--color-green) 12%, var(--color-card))' : 'var(--color-card)',
          border: `2px solid ${checked ? 'var(--color-green)' : 'var(--color-border)'}`,
          transition: 'background 0.12s, border-color 0.12s',
        }}
        aria-hidden
      >
        {checked && (
          <span
            className="rounded-full"
            style={{
              width: innerPx, height: innerPx,
              background: 'var(--color-green)',
              animation: 'radio-pop 0.18s ease both',
            }}
          />
        )}
      </span>

      {/* Text */}
      <span className="flex flex-col gap-0.5 min-w-0">
        <span
          className={`leading-snug select-none ${LABEL_CLS[size]}`}
          style={{ color: disabled ? 'var(--color-dim)' : 'var(--color-bright)' }}
        >
          {option.label}
        </span>
        {option.description && (
          <span className={`${DESC_CLS[size]} leading-snug`} style={{ color: 'var(--color-dim)' }}>
            {option.description}
          </span>
        )}
      </span>
    </label>
  )
}

// ── RadioGroup ─────────────────────────────────────────────────────────────

export function RadioGroup({
  options, value, onChange, name,
  label, orientation = 'vertical', size = 'md', error, className = '',
}: RadioGroupProps) {
  const autoName = useId()
  const groupName = name ?? autoName

  return (
    <>
      <style>{`
        @keyframes radio-pop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div
        role="radiogroup"
        aria-label={label}
        className={`flex flex-col gap-1.5 ${className}`}
      >
        {/* Group label */}
        {label && (
          <p className="text-[10px] font-semibold tracking-widest uppercase mb-1"
            style={{ color: 'var(--color-muted)' }}>
            {label}
          </p>
        )}

        {/* Options */}
        <div className={`flex ${orientation === 'horizontal' ? 'flex-row flex-wrap gap-x-5 gap-y-2' : 'flex-col gap-2'}`}>
          {options.map(opt => (
            <RadioItem
              key={opt.value}
              option={opt}
              checked={value === opt.value}
              name={groupName}
              size={size}
              onChange={onChange}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-red)' }}>{error}</p>
        )}
      </div>
    </>
  )
}

// ── RadioCardGroup — variante card selezionabile ──────────────────────────

const CARD_COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }

export function RadioCardGroup({ options, value, onChange, cols = 2 }: { options: RadioOption[]; value: string; onChange: (v: string) => void; cols?: 2 | 3 | 4 }) {
  const autoName = useId()
  return (
    <div className={`grid ${CARD_COLS[cols]} gap-2`}>
      {options.map(opt => {
        const sel = value === opt.value
        return (
          <label key={opt.value}
            className={`flex flex-col gap-1 p-3 rounded-lg border transition-all select-none ${opt.disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}
            style={{ background: sel ? 'color-mix(in srgb, var(--color-green) 8%, var(--color-panel))' : 'var(--color-panel)', borderColor: sel ? 'var(--color-green)' : 'var(--color-border)' }}>
            <input type="radio" name={autoName} value={opt.value} checked={sel} disabled={opt.disabled} onChange={() => onChange(opt.value)} className="sr-only" />
            <span className="text-[11px] font-semibold" style={{ color: sel ? 'var(--color-green)' : 'var(--color-bright)' }}>{opt.label}</span>
            {opt.description && <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>{opt.description}</span>}
          </label>
        )
      })}
    </div>
  )
}
