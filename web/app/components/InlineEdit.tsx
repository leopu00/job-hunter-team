'use client'

import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type InlineEditType = 'text' | 'number' | 'textarea'

export interface InlineEditProps {
  value:          string
  onSave:         (v: string) => void | Promise<void>
  type?:          InlineEditType
  placeholder?:   string
  emptyLabel?:    string        // testo quando value è vuoto
  validate?:      (v: string) => string | null   // ritorna stringa errore o null
  disabled?:      boolean
  renderDisplay?: (v: string) => React.ReactNode  // custom display
  className?:     string
  inputClassName?: string
  rows?:          number        // per textarea
}

// ── Spinner ────────────────────────────────────────────────────────────────
const SPIN = `@keyframes ie-spin { to { transform: rotate(360deg) } }`
const Spinner = () => (
  <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
    border: '2px solid var(--color-border)', borderTopColor: 'var(--color-green)',
    animation: 'ie-spin .7s linear infinite' }} />
)

// ── InlineEdit ─────────────────────────────────────────────────────────────

export function InlineEdit({
  value, onSave, type = 'text', placeholder = 'Clicca per modificare',
  emptyLabel, validate, disabled = false, renderDisplay,
  className = '', inputClassName = '', rows = 3,
}: InlineEditProps) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const inputRef                = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  // Sync quando value cambia esternamente
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  // Focus all'apertura
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  const startEdit = () => {
    if (disabled || loading) return
    setDraft(value)
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(value)
    setError(null)
  }

  const save = async () => {
    const trimmed = draft.trim()
    if (validate) {
      const err = validate(trimmed)
      if (err) { setError(err); return }
    }
    if (trimmed === value) { cancel(); return }
    setLoading(true)
    try {
      await onSave(trimmed)
      setEditing(false)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); save() }
    if (e.key === 'Enter' && e.ctrlKey && type === 'textarea') { e.preventDefault(); save() }
  }

  const displayValue = value || emptyLabel || placeholder

  const displayStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, color: value ? 'var(--color-bright)' : 'var(--color-dim)',
    cursor: disabled ? 'default' : 'pointer', borderRadius: 4, padding: '2px 6px',
    border: '1px solid transparent', transition: 'border-color .15s, background .15s',
    display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1.5,
    wordBreak: 'break-word', whiteSpace: type === 'textarea' ? 'pre-wrap' : 'nowrap',
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-bright)',
    background: 'var(--color-card)', border: `1px solid ${error ? 'var(--color-red)' : 'var(--color-green)'}`,
    borderRadius: 4, padding: '2px 6px', width: '100%',
    resize: type === 'textarea' ? 'vertical' : 'none', lineHeight: 1.5,
  }

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`} style={{ minWidth: 0 }}>
      <style>{SPIN}</style>

      {editing ? (
        <div className="flex flex-col gap-1">
          {type === 'textarea' ? (
            <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft} rows={rows}
              onChange={e => { setDraft(e.target.value); setError(null) }}
              onKeyDown={onKeyDown} onBlur={save} disabled={loading}
              className={inputClassName} style={inputStyle} />
          ) : (
            <input ref={inputRef as React.RefObject<HTMLInputElement>}
              type={type} value={draft}
              onChange={e => { setDraft(e.target.value); setError(null) }}
              onKeyDown={onKeyDown} onBlur={save} disabled={loading}
              className={inputClassName} style={inputStyle} />
          )}

          {/* Hint */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {loading && <Spinner />}
              {error && <span style={{ fontSize: 9, color: 'var(--color-red)', fontFamily: 'var(--font-mono)' }}>{error}</span>}
              {!error && !loading && (
                <span style={{ fontSize: 9, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>
                  {type === 'textarea' ? 'Ctrl+Enter salva' : 'Enter salva'} · Esc annulla
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <span
          style={displayStyle}
          onClick={startEdit}
          role={disabled ? undefined : 'button'}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit() } }}
          onMouseEnter={e => {
            if (!disabled) {
              (e.currentTarget as HTMLSpanElement).style.borderColor = 'var(--color-border)'
              ;(e.currentTarget as HTMLSpanElement).style.background = 'var(--color-row)'
            }
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLSpanElement).style.borderColor = 'transparent'
            ;(e.currentTarget as HTMLSpanElement).style.background  = 'transparent'
          }}
          title={disabled ? undefined : 'Clicca per modificare'}
        >
          {renderDisplay ? renderDisplay(displayValue) : displayValue}
          {!disabled && !loading && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
              <path d="M8 1l3 3-7 7H1V8L8 1z" stroke="var(--color-muted)" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          )}
        </span>
      )}
    </div>
  )
}
