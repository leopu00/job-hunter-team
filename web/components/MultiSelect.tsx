'use client'

import { useEffect, useRef, useState } from 'react'

export interface MSOption { value: string; label: string; disabled?: boolean }

export interface MultiSelectProps {
  options: MSOption[]
  value?: string[]
  defaultValue?: string[]
  onChange?: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  maxSelections?: number
  disabled?: boolean
  width?: number | string
}

export default function MultiSelect({
  options, value: ctrl, defaultValue = [], onChange,
  placeholder = 'Seleziona…', searchPlaceholder = 'Cerca…',
  maxSelections, disabled = false, width = '100%',
}: MultiSelectProps) {
  const isCtrl = ctrl !== undefined
  const [internal, setInternal] = useState<string[]>(defaultValue)
  const selected = isCtrl ? ctrl! : internal
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const containerRef      = useRef<HTMLDivElement>(null)
  const searchRef         = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 10) }, [open])

  const commit = (next: string[]) => { if (!isCtrl) setInternal(next); onChange?.(next) }
  const toggle = (val: string) => {
    if (selected.includes(val)) commit(selected.filter(v => v !== val))
    else if (!maxSelections || selected.length < maxSelections) commit([...selected, val])
  }

  const filtered      = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
  const allSelectable = filtered.filter(o => !o.disabled).map(o => o.value)
  const allSelected   = allSelectable.length > 0 && allSelectable.every(v => selected.includes(v))
  const selectAll     = () => { const n = [...new Set([...selected, ...allSelectable])]; commit(maxSelections ? n.slice(0, maxSelections) : n) }

  const base: React.CSSProperties = { fontSize: 12, padding: '3px 0', border: '1px solid var(--color-border)', borderRadius: 5, background: 'none', color: 'var(--color-dim)', cursor: 'pointer', flex: 1 }

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      {/* Trigger */}
      <div
        role="combobox" aria-expanded={open} aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !disabled && setOpen(o => !o) }
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{
          width, minHeight: 36, padding: '4px 8px', display: 'flex', flexWrap: 'wrap',
          alignItems: 'center', gap: 4, background: 'var(--color-row)', boxSizing: 'border-box',
          border: `1px solid ${open ? 'var(--color-green, #00e87a)' : 'var(--color-border)'}`,
          borderRadius: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.15s',
        }}>
        {selected.length === 0
          ? <span style={{ fontSize: 12, color: 'var(--color-dim)' }}>{placeholder}</span>
          : selected.map(val => {
              const lbl = options.find(o => o.value === val)?.label ?? val
              return (
                <span key={val} title={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px',
                  borderRadius: 4, background: 'var(--color-green, #00e87a)', color: '#000',
                  fontSize: 11, fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lbl}
                  <span role="button" aria-label={`Rimuovi ${lbl}`} onClick={e => { e.stopPropagation(); commit(selected.filter(v => v !== val)) }} style={{ cursor: 'pointer' }}>×</span>
                </span>
              )
            })
        }
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-dim)', paddingLeft: 4, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999,
          background: 'var(--color-panel)', border: '1px solid var(--color-border)',
          borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>

          {/* Search */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--color-row)',
                border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px',
                fontSize: 12, color: 'var(--color-bright)', outline: 'none' }} />
          </div>

          {/* Select all / Clear */}
          <div style={{ display: 'flex', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--color-border)' }}>
            <button onClick={selectAll} disabled={allSelected} style={base}>Seleziona tutti</button>
            <button onClick={() => commit([])} disabled={selected.length === 0} style={base}>Deseleziona</button>
          </div>

          {/* Opzioni */}
          <div role="listbox" aria-multiselectable="true" style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-dim)', textAlign: 'center' }}>Nessun risultato</div>
            )}
            {filtered.map(opt => {
              const isSel = selected.includes(opt.value)
              const atMax = !isSel && !!maxSelections && selected.length >= maxSelections
              return (
                <div key={opt.value} role="option" aria-selected={isSel}
                  onClick={() => !opt.disabled && !atMax && toggle(opt.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12,
                    cursor: opt.disabled || atMax ? 'default' : 'pointer',
                    opacity: opt.disabled || atMax ? 0.4 : 1,
                    color: isSel ? 'var(--color-green, #00e87a)' : 'var(--color-bright)',
                    background: isSel ? 'color-mix(in srgb, var(--color-green,#00e87a) 8%, transparent)' : 'transparent',
                    transition: 'background 0.1s' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: `2px solid ${isSel ? 'var(--color-green,#00e87a)' : 'var(--color-border)'}`,
                    background: isSel ? 'var(--color-green,#00e87a)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#000', fontWeight: 700 }}>
                    {isSel && '✓'}
                  </span>
                  {opt.label}
                </div>
              )
            })}
          </div>

          {maxSelections && (
            <div style={{ padding: '4px 10px', fontSize: 10, color: 'var(--color-dim)',
              borderTop: '1px solid var(--color-border)', textAlign: 'right' }}>
              {selected.length} / {maxSelections}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
