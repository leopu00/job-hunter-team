'use client'

import { useRef, useEffect, useId } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type CheckboxSize = 'sm' | 'md' | 'lg'

export interface CheckboxProps {
  checked:       boolean
  onChange:      (checked: boolean) => void
  label?:        string
  description?:  string
  disabled?:     boolean
  indeterminate?: boolean
  size?:         CheckboxSize
  error?:        string
  id?:           string
  className?:    string
}

// ── Size maps ──────────────────────────────────────────────────────────────

const BOX_SIZE: Record<CheckboxSize, number> = { sm: 14, md: 16, lg: 20 }
const LABEL_CLS: Record<CheckboxSize, string> = { sm: 'text-[10px]', md: 'text-[11px]', lg: 'text-[12px]' }
const DESC_CLS:  Record<CheckboxSize, string> = { sm: 'text-[9px]',  md: 'text-[10px]', lg: 'text-[11px]' }

// ── Checkbox ───────────────────────────────────────────────────────────────

export function Checkbox({
  checked, onChange, label, description, disabled = false,
  indeterminate = false, size = 'md', error, id, className = '',
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autoId   = useId()
  const fieldId  = id ?? autoId

  // Sync indeterminate prop (non supportato come attributo HTML)
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const px    = BOX_SIZE[size]
  const active = checked || indeterminate
  const borderColor = error ? 'var(--color-red)' : active ? 'var(--color-green)' : 'var(--color-border)'
  const bg = active ? 'var(--color-green)' : 'transparent'

  return (
    <>
      <style>{`
        @keyframes cb-pop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .cb-mark { animation: cb-pop 0.18s ease both; }
      `}</style>

      <div className={`inline-flex flex-col gap-0.5 ${disabled ? 'opacity-45' : ''} ${className}`}>
        <label
          htmlFor={fieldId}
          className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {/* Hidden native input per accessibilità e form */}
          <input
            ref={inputRef}
            id={fieldId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={e => onChange(e.target.checked)}
            aria-checked={indeterminate ? 'mixed' : checked}
            aria-invalid={!!error}
            className="sr-only"
          />

          {/* Custom box */}
          <span
            className="flex items-center justify-center flex-shrink-0 rounded transition-colors"
            style={{
              width: px, height: px,
              background: active ? bg : 'var(--color-card)',
              border: `2px solid ${borderColor}`,
              transition: 'background 0.12s, border-color 0.12s',
            }}
            aria-hidden
          >
            {active && (
              <span className="cb-mark" style={{ color: '#000', lineHeight: 1 }}>
                {indeterminate ? (
                  // Dash per indeterminate
                  <svg width={px - 6} height={px - 6} viewBox="0 0 10 10" fill="none">
                    <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  // Checkmark
                  <svg width={px - 6} height={px - 6} viewBox="0 0 10 10" fill="none">
                    <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            )}
          </span>

          {/* Label */}
          {label && (
            <span className={`leading-snug select-none ${LABEL_CLS[size]}`}
              style={{ color: disabled ? 'var(--color-dim)' : 'var(--color-bright)' }}>
              {label}
            </span>
          )}
        </label>

        {/* Description */}
        {description && (
          <p className={`${DESC_CLS[size]} ml-[calc(${px}px+8px)]`}
            style={{ color: 'var(--color-dim)', marginLeft: px + 8 }}>
            {description}
          </p>
        )}

        {/* Error */}
        {error && (
          <p className={`${DESC_CLS[size]}`} style={{ color: 'var(--color-red)', marginLeft: px + 8 }}>
            {error}
          </p>
        )}
      </div>
    </>
  )
}

// ── CheckboxGroup ──────────────────────────────────────────────────────────

export interface CheckboxOption {
  value:        string
  label:        string
  description?: string
  disabled?:    boolean
}

export interface CheckboxGroupProps {
  options:    CheckboxOption[]
  value:      string[]
  onChange:   (value: string[]) => void
  label?:     string
  size?:      CheckboxSize
  error?:     string
  selectAll?: boolean   // mostra checkbox select-all con indeterminate
}

export function CheckboxGroup({
  options, value, onChange, label, size = 'md', error, selectAll = false,
}: CheckboxGroupProps) {
  const allChecked  = options.every(o => value.includes(o.value))
  const someChecked = options.some(o => value.includes(o.value))

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])

  const toggleAll = () =>
    onChange(allChecked ? [] : options.filter(o => !o.disabled).map(o => o.value))

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>
          {label}
        </p>
      )}

      {selectAll && (
        <Checkbox
          checked={allChecked}
          indeterminate={someChecked && !allChecked}
          onChange={toggleAll}
          label="Seleziona tutti"
          size={size}
        />
      )}

      {options.map(opt => (
        <Checkbox
          key={opt.value}
          checked={value.includes(opt.value)}
          onChange={() => toggle(opt.value)}
          label={opt.label}
          description={opt.description}
          disabled={opt.disabled}
          size={size}
        />
      ))}

      {error && <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}
