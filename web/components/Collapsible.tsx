'use client'

import { useEffect, useRef, useState } from 'react'

export interface CollapsibleProps {
  /** Contenuto header — stringa o ReactNode */
  header: React.ReactNode
  children: React.ReactNode
  /** Controlled: stato aperto */
  open?: boolean
  /** Uncontrolled: aperto di default */
  defaultOpen?: boolean
  onChange?: (open: boolean) => void
  disabled?: boolean
  /** Variante visiva */
  variant?: 'default' | 'bordered' | 'ghost'
  /** Posizione chevron */
  chevronSide?: 'left' | 'right'
}

const VARIANTS = {
  default: {
    container: { background: 'var(--color-row)', borderRadius: 8 },
    header:    { padding: '10px 14px', borderRadius: 8 },
  },
  bordered: {
    container: { border: '1px solid var(--color-border)', borderRadius: 8 },
    header:    { padding: '10px 14px', borderRadius: 8 },
  },
  ghost: {
    container: {},
    header:    { padding: '6px 0' },
  },
}

/* ── Chevron SVG ── */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={16} height={16} viewBox="0 0 16 16"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        color: 'var(--color-dim)',
      }}
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  )
}

export default function Collapsible({
  header,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onChange,
  disabled = false,
  variant = 'default',
  chevronSide = 'right',
}: CollapsibleProps) {
  const isControlled = controlledOpen !== undefined
  const [internal, setInternal] = useState(defaultOpen)
  const open = isControlled ? controlledOpen! : internal

  const bodyRef    = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>(defaultOpen ? 'auto' : 0)
  const [visible, setVisible] = useState(defaultOpen)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── Animazione height ── */
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (timerRef.current) clearTimeout(timerRef.current)

    if (open) {
      setVisible(true)
      // Misura scrollHeight nel prossimo frame
      requestAnimationFrame(() => {
        setHeight(el.scrollHeight)
        timerRef.current = setTimeout(() => setHeight('auto'), 280)
      })
    } else {
      // Fissa altezza esatta prima di animare a 0
      setHeight(el.scrollHeight)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0)
          timerRef.current = setTimeout(() => setVisible(false), 280)
        })
      })
    }
  }, [open])

  const toggle = () => {
    if (disabled) return
    const next = !open
    if (!isControlled) setInternal(next)
    onChange?.(next)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
  }

  const { container, header: headerStyle } = VARIANTS[variant]

  const headerEl = (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={handleKey}
      className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] rounded"
      style={{
        ...headerStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        opacity: disabled ? 0.5 : 1,
        flexDirection: chevronSide === 'left' ? 'row-reverse' : 'row',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--color-bright)' }}>
        {header}
      </span>
      <Chevron open={open} />
    </div>
  )

  return (
    <div style={{ ...container, overflow: 'hidden' }}>
      {headerEl}

      {/* Body animato */}
      <div
        ref={bodyRef}
        style={{
          height: height === 'auto' ? 'auto' : height,
          overflow: 'hidden',
          transition: height === 'auto' ? 'none' : 'height 0.27s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {visible && (
          <div style={{
            padding: variant === 'ghost' ? '6px 0' : '0 14px 12px',
            fontSize: 13,
            color: 'var(--color-dim)',
          }}>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
