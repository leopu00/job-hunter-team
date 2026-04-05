'use client'

import { useEffect, useRef, useState } from 'react'

export type DropdownAlign = 'left' | 'right'

export interface DropdownItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Se presente, inserisce separatore PRIMA di questo item */
  separator?: boolean
}

export interface DropdownProps {
  /** Elemento trigger — se stringa, renderizza un button con quella label */
  trigger: React.ReactNode | string
  items: DropdownItem[]
  onSelect: (item: DropdownItem) => void
  align?: DropdownAlign
  /** Larghezza minima menu in px */
  minWidth?: number
  disabled?: boolean
}

export default function Dropdown({ trigger, items, onSelect, align = 'left', minWidth = 180, disabled = false }: DropdownProps) {
  const [open, setOpen]     = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef      = useRef<HTMLDivElement>(null)

  // Indici navigabili (no separator, no disabled)
  const navigable = items.filter(i => !i.disabled)

  // Chiudi su click fuori
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) { setOpen(false); setFocusIdx(-1) } }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // Focus prima voce all'apertura
  useEffect(() => { if (open) setFocusIdx(-1) }, [open])

  const handleTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setFocusIdx(0) }
    if (e.key === 'Escape') setOpen(false)
  }

  const handleMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx(i => {
        for (let next = i + 1; next < items.length; next++) if (!items[next]?.disabled) return next
        return i
      })
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx(i => {
        for (let prev = i - 1; prev >= 0; prev--) if (!items[prev]?.disabled) return prev
        return i
      })
    }
    if (e.key === 'Enter' && focusIdx >= 0) {
      e.preventDefault()
      const item = items[focusIdx]
      if (item && !item.disabled) { onSelect(item); setOpen(false); setFocusIdx(-1) }
    }
    if (e.key === 'Tab') { setOpen(false); setFocusIdx(-1) }
  }

  const handleSelect = (item: DropdownItem) => {
    if (item.disabled) return
    onSelect(item)
    setOpen(false)
    setFocusIdx(-1)
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <div
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={handleTriggerKey}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] rounded"
        style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
      >
        {typeof trigger === 'string' ? (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
            style={{ background: open ? 'var(--color-row)' : 'var(--color-panel)', border: `1px solid ${open ? 'var(--color-border-glow)' : 'var(--color-border)'}`, color: 'var(--color-muted)', cursor: 'inherit' }}
            tabIndex={-1}>
            {trigger} <span style={{ fontSize: 8, marginLeft: 2, opacity: 0.6 }}>▾</span>
          </button>
        ) : trigger}
      </div>

      {/* Menu */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={handleMenuKey}
          tabIndex={-1}
          className="absolute z-50 rounded-lg border overflow-hidden py-1 mt-1"
          style={{
            [align === 'right' ? 'right' : 'left']: 0,
            minWidth,
            borderColor: 'var(--color-border)',
            background: 'var(--color-panel)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            animation: 'fade-in 0.1s ease both',
          }}>
          {items.map((item, i) => (
            <div key={item.id}>
              {item.separator && <div className="my-1" style={{ height: 1, background: 'var(--color-border)' }} />}
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => !item.disabled && setFocusIdx(i)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-left transition-colors"
                style={{
                  background: i === focusIdx ? 'var(--color-row)' : 'transparent',
                  color: item.disabled ? 'var(--color-border)' : item.danger ? 'var(--color-red)' : 'var(--color-muted)',
                  cursor: item.disabled ? 'default' : 'pointer',
                  border: 'none', display: 'flex',
                }}>
                {item.icon && <span className="text-sm flex-shrink-0">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--color-dim)' }}>{item.shortcut}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
