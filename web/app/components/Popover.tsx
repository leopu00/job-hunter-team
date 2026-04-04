'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto'
export type PopoverTrigger   = 'click' | 'hover'

export type PopoverProps = {
  content:     ReactNode
  placement?:  PopoverPlacement
  trigger?:    PopoverTrigger
  defaultOpen?: boolean
  disabled?:   boolean
  maxWidth?:   number
  showArrow?:  boolean
  onOpen?:     () => void
  onClose?:    () => void
  children:    ReactNode
  className?:  string
}

// ── Placement helpers ──────────────────────────────────────────────────────

type Side = 'top' | 'bottom' | 'left' | 'right'

function autoSide(r: DOMRect): Side {
  if (r.top > 120)                          return 'top'
  if (window.innerHeight - r.bottom > 120) return 'bottom'
  if (r.left > 160)                         return 'left'
  return 'right'
}

const GAP = 8

type CSSPos = { top?: string; bottom?: string; left?: string; right?: string; transform: string }

function popStyle(side: Side): CSSPos {
  switch (side) {
    case 'top':    return { bottom: `calc(100% + ${GAP}px)`, left: '50%',  transform: 'translateX(-50%)' }
    case 'bottom': return { top:    `calc(100% + ${GAP}px)`, left: '50%',  transform: 'translateX(-50%)' }
    case 'left':   return { right:  `calc(100% + ${GAP}px)`, top:  '50%',  transform: 'translateY(-50%)' }
    case 'right':  return { left:   `calc(100% + ${GAP}px)`, top:  '50%',  transform: 'translateY(-50%)' }
  }
}

function arrowStyle(side: Side): React.CSSProperties {
  const S = 5; const bg = 'var(--color-panel)'
  const base: React.CSSProperties = { position: 'absolute', width: 0, height: 0 }
  switch (side) {
    case 'top':    return { ...base, top: '100%',    left: '50%', transform: 'translateX(-50%)', borderLeft: `${S}px solid transparent`, borderRight: `${S}px solid transparent`, borderTop: `${S}px solid ${bg}` }
    case 'bottom': return { ...base, bottom: '100%', left: '50%', transform: 'translateX(-50%)', borderLeft: `${S}px solid transparent`, borderRight: `${S}px solid transparent`, borderBottom: `${S}px solid ${bg}` }
    case 'left':   return { ...base, left: '100%',   top: '50%',  transform: 'translateY(-50%)', borderTop: `${S}px solid transparent`, borderBottom: `${S}px solid transparent`, borderLeft: `${S}px solid ${bg}` }
    case 'right':  return { ...base, right: '100%',  top: '50%',  transform: 'translateY(-50%)', borderTop: `${S}px solid transparent`, borderBottom: `${S}px solid transparent`, borderRight: `${S}px solid ${bg}` }
  }
}

// ── Popover ────────────────────────────────────────────────────────────────

export function Popover({
  content, placement = 'auto', trigger = 'click', defaultOpen = false,
  disabled, maxWidth = 280, showArrow = true, onOpen, onClose, children, className,
}: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [side, setSide] = useState<Side>('bottom')
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Click-outside dismiss
  useEffect(() => {
    if (!open || trigger !== 'click') return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); onClose?.()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, trigger, onClose])

  // ESC dismiss
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); onClose?.() } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const computeSide = useCallback(() => {
    if (!wrapRef.current) return 'bottom' as Side
    const r = wrapRef.current.getBoundingClientRect()
    return placement === 'auto' ? autoSide(r) : placement as Side
  }, [placement])

  const show = useCallback(() => {
    if (disabled) return
    setSide(computeSide())
    setOpen(true); onOpen?.()
  }, [disabled, computeSide, onOpen])

  const hide = useCallback(() => { setOpen(false); onClose?.() }, [onClose])

  // Hover trigger handlers
  const onMouseEnter = trigger === 'hover' ? () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    show()
  } : undefined

  const onMouseLeave = trigger === 'hover' ? () => {
    hoverTimer.current = setTimeout(hide, 120)
  } : undefined

  const onClick = trigger === 'click' ? () => {
    if (open) hide(); else show()
  } : undefined

  const pos = popStyle(side)

  return (
    <div ref={wrapRef} className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>

      {/* Trigger */}
      <div onClick={onClick} style={{ cursor: trigger === 'click' ? 'pointer' : 'default' }}>
        {children}
      </div>

      {/* Popover panel */}
      {open && (
        <div role="dialog"
          onMouseEnter={trigger === 'hover' ? () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) } : undefined}
          onMouseLeave={trigger === 'hover' ? () => { hoverTimer.current = setTimeout(hide, 120) } : undefined}
          style={{
            position:     'absolute',
            zIndex:       9000,
            maxWidth,
            ...pos,
            background:   'var(--color-panel)',
            border:       '1px solid var(--color-border)',
            borderRadius: 10,
            boxShadow:    '0 8px 24px rgba(0,0,0,0.45)',
            animation:    'pop-in 0.14s ease',
          }}>
          {showArrow && <span style={arrowStyle(side)} />}
          {content}
        </div>
      )}

      <style>{`
        @keyframes pop-in {
          from { opacity: 0; transform: ${pos.transform} scale(0.94); }
          to   { opacity: 1; transform: ${pos.transform} scale(1); }
        }
      `}</style>
    </div>
  )
}

// ── usePopover — hook per controllo esterno ────────────────────────────────

export function usePopover() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), hide: () => setOpen(false), toggle: () => setOpen(v => !v) }
}
