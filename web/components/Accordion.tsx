'use client'

import { useEffect, useRef, useState } from 'react'

export interface AccordionItem {
  id: string
  title: string
  /** Icona opzionale a sinistra del titolo */
  icon?: string
  /** Badge/conteggio a destra del titolo */
  badge?: string | number
  content: React.ReactNode
  /** Disabilita questo item */
  disabled?: boolean
  /** Aperto di default */
  defaultOpen?: boolean
}

export interface AccordionProps {
  items: AccordionItem[]
  /** 'single' = uno aperto alla volta, 'multi' = più aperti insieme */
  mode?: 'single' | 'multi'
  /** Bordo separatore tra items */
  divided?: boolean
  /** Variante visiva */
  variant?: 'default' | 'bordered' | 'ghost'
}

function AccordionPanel({ item, open, onToggle, divided, variant }: {
  item: AccordionItem
  open: boolean
  onToggle: () => void
  divided: boolean
  variant: 'default' | 'bordered' | 'ghost'
}) {
  const bodyRef   = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>(open ? 'auto' : 0)
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (open) {
      setVisible(true)
      setHeight(el.scrollHeight)
      const t = window.setTimeout(() => setHeight('auto'), 260)
      return () => clearTimeout(t)
    } else {
      setHeight(el.scrollHeight)
      requestAnimationFrame(() => requestAnimationFrame(() => setHeight(0)))
      const t = window.setTimeout(() => setVisible(false), 260)
      return () => clearTimeout(t)
    }
  }, [open])

  const isBordered = variant === 'bordered'
  const isGhost    = variant === 'ghost'

  return (
    <div
      style={{
        borderRadius: isBordered ? 8 : 0,
        border: isBordered ? `1px solid ${open ? 'var(--color-border-glow, var(--color-border))' : 'var(--color-border)'}` : 'none',
        marginBottom: isBordered ? 6 : 0,
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}>
      {/* Header */}
      <button
        onClick={() => !item.disabled && onToggle()}
        disabled={item.disabled}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: isGhost ? '8px 4px' : '10px 14px',
          background: open && !isGhost ? 'var(--color-row)' : 'transparent',
          border: 'none',
          borderBottom: divided && !isBordered ? `1px solid var(--color-border)` : 'none',
          cursor: item.disabled ? 'default' : 'pointer',
          opacity: item.disabled ? 0.45 : 1,
          transition: 'background 0.15s ease',
          textAlign: 'left',
        }}>
        {item.icon && (
          <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
        )}
        <span style={{
          flex: 1, fontSize: 12, fontWeight: 600,
          color: open ? 'var(--color-bright)' : 'var(--color-muted)',
          transition: 'color 0.15s ease',
        }}>
          {item.title}
        </span>
        {item.badge !== undefined && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
            background: 'var(--color-border)', color: 'var(--color-dim)',
            flexShrink: 0,
          }}>
            {item.badge}
          </span>
        )}
        {/* Chevron */}
        <span style={{
          fontSize: 10, flexShrink: 0,
          color: open ? 'var(--color-green)' : 'var(--color-dim)',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.25s ease, color 0.15s ease',
          display: 'inline-block',
        }}>▾</span>
      </button>

      {/* Body animato */}
      <div
        ref={bodyRef}
        style={{
          height: height === 'auto' ? 'auto' : `${height}px`,
          overflow: height === 'auto' ? 'visible' : 'hidden',
          transition: 'height 0.25s ease',
        }}>
        {visible && (
          <div style={{
            padding: isGhost ? '8px 4px 4px' : '12px 14px',
            fontSize: 11,
            color: 'var(--color-muted)',
            borderTop: !isBordered && open ? `1px solid var(--color-border)` : 'none',
          }}>
            {item.content}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Accordion({
  items,
  mode = 'single',
  divided = true,
  variant = 'default',
}: AccordionProps) {
  const defaultOpen = new Set(items.filter(i => i.defaultOpen).map(i => i.id))
  const [openIds, setOpenIds] = useState<Set<string>>(defaultOpen)

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (mode === 'single') next.clear()
        next.add(id)
      }
      return next
    })
  }

  return (
    <div style={{ width: '100%' }}>
      {items.map((item, i) => (
        <div key={item.id}>
          {divided && variant === 'default' && i > 0 && (
            <div style={{ height: 1, background: 'var(--color-border)' }} />
          )}
          <AccordionPanel
            item={item}
            open={openIds.has(item.id)}
            onToggle={() => toggle(item.id)}
            divided={divided}
            variant={variant}
          />
        </div>
      ))}
    </div>
  )
}
