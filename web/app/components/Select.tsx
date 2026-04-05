'use client'

import { useState, useRef, useEffect, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type SelectOption = {
  value:     string
  label:     string
  icon?:     string
  disabled?: boolean
}

export type SelectProps = {
  options:      SelectOption[]
  value:        string | string[]
  onChange:     (v: string | string[]) => void
  placeholder?: string
  searchable?:  boolean
  multiple?:    boolean
  clearable?:   boolean
  disabled?:    boolean
  className?:   string
}

// ── Select ─────────────────────────────────────────────────────────────────

export function Select({
  options, value, onChange,
  placeholder = 'Seleziona…', searchable, multiple, clearable, disabled, className,
}: SelectProps) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const [hi,     setHi]     = useState(-1)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = multiple ? (value as string[]) : value ? [value as string] : []
  const hasValue = selected.length > 0

  const filtered = useMemo(() =>
    options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()))
  , [options, search])

  // Click-outside
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Focus search input on open
  useEffect(() => { if (open && searchable) setTimeout(() => inputRef.current?.focus(), 0) }, [open, searchable])

  const isSelected = (v: string) => selected.includes(v)

  const select = (v: string) => {
    if (multiple) {
      onChange(isSelected(v) ? selected.filter(s => s !== v) : [...selected, v])
    } else {
      onChange(v); setOpen(false); setSearch('')
    }
  }

  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange(multiple ? [] : '') }

  const removeChip = (e: React.MouseEvent, v: string) => {
    e.stopPropagation()
    onChange(selected.filter(s => s !== v))
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === ' ') { setOpen(true); e.preventDefault() }; return }
    if (e.key === 'Escape')    { setOpen(false); setSearch(''); return }
    if (e.key === 'ArrowDown') { setHi(h => Math.min(h + 1, filtered.length - 1)); e.preventDefault() }
    if (e.key === 'ArrowUp')   { setHi(h => Math.max(h - 1, 0)); e.preventDefault() }
    if (e.key === 'Enter' && hi >= 0) { const o = filtered[hi]; if (o && !o.disabled) select(o.value); e.preventDefault() }
  }

  const selectedLabels = options.filter(o => selected.includes(o.value))

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}
      onKeyDown={handleKey} tabIndex={disabled ? -1 : 0}>

      {/* Trigger */}
      <div onClick={() => !disabled && setOpen(v => !v)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer flex-wrap"
        style={{ background: 'var(--color-deep)', border: `1px solid ${open ? 'var(--color-blue)' : 'var(--color-border)'}`, minHeight: 36, opacity: disabled ? 0.5 : 1, transition: 'border-color 0.15s' }}>

        {/* Chips (multiple) */}
        {multiple && selectedLabels.length > 0 && selectedLabels.map(o => (
          <span key={o.value} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold"
            style={{ background: 'var(--color-blue)20', color: 'var(--color-blue)', border: '1px solid var(--color-blue)40' }}>
            {o.label}
            <button onClick={e => removeChip(e, o.value)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 11 }}>×</button>
          </span>
        ))}

        {/* Single value */}
        {!multiple && hasValue && (
          <span className="flex-1 text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
            {selectedLabels[0]?.icon && <span className="mr-1">{selectedLabels[0].icon}</span>}
            {selectedLabels[0]?.label}
          </span>
        )}

        {/* Placeholder */}
        {!hasValue && <span className="flex-1 text-[11px]" style={{ color: 'var(--color-dim)' }}>{placeholder}</span>}

        {/* Controls */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {clearable && hasValue && (
            <button onClick={clear} aria-label="Cancella selezione" style={{ background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
          )}
          <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div role="listbox" className="absolute w-full top-full mt-1 rounded-lg z-50 overflow-hidden"
          style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 240, overflowY: 'auto', animation: 'sel-in 0.12s ease' }}>

          {/* Search */}
          {searchable && (
            <div className="px-2 pt-2 pb-1 sticky top-0" style={{ background: 'var(--color-deep)' }}>
              <input ref={inputRef} value={search} onChange={e => { setSearch(e.target.value); setHi(-1) }}
                placeholder="Cerca…" className="w-full bg-transparent outline-none px-2 py-1.5 rounded text-[11px]"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }} />
            </div>
          )}

          {/* Options */}
          {filtered.length === 0
            ? <p className="px-3 py-4 text-[10px] text-center" style={{ color: 'var(--color-dim)' }}>Nessun risultato</p>
            : filtered.map((opt, i) => {
                const sel = isSelected(opt.value)
                return (
                  <div key={opt.value} onClick={() => !opt.disabled && select(opt.value)}
                    className="flex items-center gap-2 px-3 py-2 text-[11px] transition-colors"
                    style={{ background: i === hi ? 'var(--color-border)' : sel ? 'var(--color-blue)10' : 'transparent', color: opt.disabled ? 'var(--color-dim)' : sel ? 'var(--color-blue)' : 'var(--color-muted)', cursor: opt.disabled ? 'not-allowed' : 'pointer' }}>
                    {opt.icon && <span>{opt.icon}</span>}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {sel && <span style={{ color: 'var(--color-blue)', fontSize: 10 }}>✓</span>}
                  </div>
                )
              })
          }
        </div>
      )}
      <style>{`@keyframes sel-in { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}
