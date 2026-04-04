'use client'

import { useState, useId, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type FieldValidator = (value: string) => string | null   // null = valid

export type FormFieldProps = {
  label?:       string
  help?:        string
  error?:       string          // errore esterno (es. da submit)
  required?:    boolean
  disabled?:    boolean
  className?:   string
  children?:    ReactNode       // custom input/select
}

// ── Shared field styles ────────────────────────────────────────────────────

export const fieldInputStyle = (error: boolean, disabled: boolean): React.CSSProperties => ({
  width:        '100%',
  background:   disabled ? 'var(--color-border)' : 'var(--color-deep)',
  border:       `1px solid ${error ? 'var(--color-red)' : 'var(--color-border)'}`,
  borderRadius: 8,
  padding:      '7px 10px',
  fontSize:     11,
  color:        disabled ? 'var(--color-dim)' : 'var(--color-muted)',
  outline:      'none',
  transition:   'border-color 0.15s',
  cursor:       disabled ? 'not-allowed' : 'auto',
  boxSizing:    'border-box',
})

// ── FormField wrapper ──────────────────────────────────────────────────────

export function FormField({ label, help, error, required, disabled, className, children }: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      {label && (
        <label className="text-[10px] font-semibold flex items-center gap-1"
          style={{ color: 'var(--color-muted)' }}>
          {label}
          {required && <span style={{ color: 'var(--color-red)' }}>*</span>}
        </label>
      )}
      <div style={{ opacity: disabled ? 0.6 : 1 }}>{children}</div>
      {error && (
        <p className="text-[9px] flex items-center gap-1" style={{ color: 'var(--color-red)' }}>
          <span>⚠</span>{error}
        </p>
      )}
      {!error && help && (
        <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>{help}</p>
      )}
    </div>
  )
}

// ── TextField — input text con validazione inline ─────────────────────────

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label?:     string
  help?:      string
  error?:     string
  validate?:  FieldValidator
  className?: string
}

export function TextField({ label, help, error: externalError, validate, className, onBlur, onChange, ...rest }: TextFieldProps) {
  const [inlineError, setInlineError] = useState<string | null>(null)
  const id = useId()

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (validate) setInlineError(validate(e.target.value))
    onBlur?.(e)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inlineError && validate) setInlineError(validate(e.target.value))
    onChange?.(e)
  }

  const err = externalError ?? inlineError ?? undefined

  return (
    <FormField label={label} help={help} error={err} required={rest.required} disabled={rest.disabled} className={className}>
      <input id={id} {...rest} onBlur={handleBlur} onChange={handleChange}
        style={fieldInputStyle(!!err, !!rest.disabled)} />
    </FormField>
  )
}

// ── TextAreaField ──────────────────────────────────────────────────────────

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  label?:     string
  help?:      string
  error?:     string
  validate?:  FieldValidator
  className?: string
}

export function TextAreaField({ label, help, error: externalError, validate, className, onBlur, onChange, rows = 4, ...rest }: TextAreaFieldProps) {
  const [inlineError, setInlineError] = useState<string | null>(null)
  const id = useId()

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (validate) setInlineError(validate(e.target.value))
    onBlur?.(e)
  }
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (inlineError && validate) setInlineError(validate(e.target.value))
    onChange?.(e)
  }

  const err = externalError ?? inlineError ?? undefined

  return (
    <FormField label={label} help={help} error={err} required={rest.required} disabled={rest.disabled} className={className}>
      <textarea id={id} rows={rows} {...rest} onBlur={handleBlur} onChange={handleChange}
        style={{ ...fieldInputStyle(!!err, !!rest.disabled), resize: 'vertical', fontFamily: 'inherit' }} />
    </FormField>
  )
}

// ── SelectField ────────────────────────────────────────────────────────────

type SelectOption = { value: string; label: string }

type SelectFieldProps = Omit<InputHTMLAttributes<HTMLSelectElement>, 'className'> & {
  label?:     string
  help?:      string
  error?:     string
  options:    SelectOption[]
  placeholder?: string
  className?: string
}

export function SelectField({ label, help, error, options, placeholder, className, ...rest }: SelectFieldProps) {
  return (
    <FormField label={label} help={help} error={error} required={rest.required} disabled={rest.disabled} className={className}>
      <select {...(rest as React.SelectHTMLAttributes<HTMLSelectElement>)}
        style={{ ...fieldInputStyle(!!error, !!rest.disabled), appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FormField>
  )
}

// ── Validators comuni ──────────────────────────────────────────────────────

export const validators = {
  required: (msg = 'Campo obbligatorio'): FieldValidator =>
    v => v.trim() ? null : msg,
  minLength: (n: number): FieldValidator =>
    v => v.length >= n ? null : `Minimo ${n} caratteri`,
  email: (): FieldValidator =>
    v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Email non valida',
  url: (): FieldValidator =>
    v => !v || /^https?:\/\/.+/.test(v) ? null : 'URL non valido',
  compose: (...fns: FieldValidator[]): FieldValidator =>
    v => fns.reduce<string | null>((err, fn) => err ?? fn(v), null),
}
