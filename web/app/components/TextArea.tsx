'use client'

import { useRef, useEffect, useId, type TextareaHTMLAttributes } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type ResizeMode = 'none' | 'vertical' | 'horizontal' | 'both'

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value:        string
  onChange:     (value: string) => void
  label?:       string
  help?:        string
  error?:       string
  maxLength?:   number
  rows?:        number
  resize?:      ResizeMode
  autoResize?:  boolean
  fullWidth?:   boolean
}

// ── TextArea ───────────────────────────────────────────────────────────────

export function TextArea({
  value, onChange, label, help, error, maxLength,
  rows = 4, resize = 'vertical', autoResize = false,
  fullWidth = false, disabled = false, placeholder,
  id, className = '', ...rest
}: TextAreaProps) {
  const autoId  = useId()
  const fieldId = id ?? autoId
  const ref     = useRef<HTMLTextAreaElement>(null)

  // Auto-resize: aggiusta altezza al contenuto
  useEffect(() => {
    if (!autoResize || !ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = `${ref.current.scrollHeight}px`
  }, [value, autoResize])

  const count    = value.length
  const overLimit = maxLength !== undefined && count > maxLength
  const borderColor = error || overLimit ? 'var(--color-red)' : 'var(--color-border)'
  const focusColor  = error || overLimit ? 'var(--color-red)' : 'var(--color-green)'

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''} ${className}`}>
      {/* Label row */}
      {(label || maxLength !== undefined) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={fieldId}
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: 'var(--color-muted)' }}>
              {label}
            </label>
          )}
          {maxLength !== undefined && (
            <span className="text-[9px] font-mono tabular-nums"
              style={{ color: overLimit ? 'var(--color-red)' : 'var(--color-dim)' }}>
              {count}/{maxLength}
            </span>
          )}
        </div>
      )}

      {/* Textarea */}
      <textarea
        {...rest}
        ref={ref}
        id={fieldId}
        value={value}
        rows={autoResize ? undefined : rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={!!(error || overLimit)}
        aria-describedby={help ? `${fieldId}-help` : undefined}
        onChange={e => onChange(e.target.value)}
        onFocus={e => { e.currentTarget.style.borderColor = focusColor }}
        onBlur={e  => { e.currentTarget.style.borderColor = borderColor }}
        className={`font-mono text-[11px] leading-relaxed rounded bg-[var(--color-card)] outline-none transition-colors placeholder:text-[var(--color-dim)] ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
        style={{
          color:       'var(--color-bright)',
          border:      `1px solid ${borderColor}`,
          padding:     '10px 12px',
          resize:      autoResize ? 'none' : resize,
          minHeight:   autoResize ? 80 : undefined,
          overflowY:   autoResize ? 'hidden' : undefined,
        }}
      />

      {/* Help / Error */}
      {(help || error) && (
        <p id={`${fieldId}-help`} className="text-[10px] leading-snug"
          style={{ color: error ? 'var(--color-red)' : 'var(--color-dim)' }}>
          {error ?? help}
        </p>
      )}
    </div>
  )
}

// ── CharCount (standalone per composizioni custom) ─────────────────────────

export function CharCount({ current, max, className = '' }: { current: number; max: number; className?: string }) {
  const over = current > max
  const pct  = Math.min(current / max, 1)
  const color = over ? 'var(--color-red)' : pct > 0.85 ? 'var(--color-yellow)' : 'var(--color-green)'
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Mini progress bar */}
      <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="text-[9px] font-mono tabular-nums" style={{ color: over ? 'var(--color-red)' : 'var(--color-dim)' }}>
        {current}/{max}
      </span>
    </div>
  )
}

// ── CodeArea (shorthand per input codice/JSON) ─────────────────────────────

export function CodeArea({ value, onChange, label, error, rows = 8, fullWidth = true }: Pick<TextAreaProps, 'value' | 'onChange' | 'label' | 'error' | 'rows' | 'fullWidth'>) {
  return (
    <TextArea
      value={value}
      onChange={onChange}
      label={label}
      error={error}
      rows={rows}
      fullWidth={fullWidth}
      resize="vertical"
      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, tabSize: 2 } as React.CSSProperties}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  )
}
