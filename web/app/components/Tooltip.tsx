'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto'

export type TooltipProps = {
  content:     ReactNode
  placement?:  TooltipPlacement
  delay?:      number     // ms prima di mostrare (default 400)
  disabled?:   boolean
  maxWidth?:   number     // px (default 220)
  children:    ReactNode
  className?:  string
}

// ── Helpers ────────────────────────────────────────────────────────────────

type Side = 'top' | 'bottom' | 'left' | 'right'

function autoSide(r: DOMRect): Side {
  if (r.top > 90)                          return 'top'
  if (window.innerHeight - r.bottom > 90) return 'bottom'
  if (r.left > 140)                        return 'left'
  return 'right'
}

function resolveSide(pref: TooltipPlacement, r: DOMRect): Side {
  return pref === 'auto' ? autoSide(r) : pref
}

// Posizione tooltip relativa al wrapper (position:relative)
// I valori sono stringhe CSS applicate all'elemento assoluto
type CSSPos = { top?: string; bottom?: string; left?: string; right?: string; transform: string }

function tooltipStyle(side: Side, gap = 8): CSSPos {
  switch (side) {
    case 'top':    return { bottom: `calc(100% + ${gap}px)`, left: '50%',  transform: 'translateX(-50%)' }
    case 'bottom': return { top:    `calc(100% + ${gap}px)`, left: '50%',  transform: 'translateX(-50%)' }
    case 'left':   return { right:  `calc(100% + ${gap}px)`, top:  '50%',  transform: 'translateY(-50%)' }
    case 'right':  return { left:   `calc(100% + ${gap}px)`, top:  '50%',  transform: 'translateY(-50%)' }
  }
}

// Stile freccia
function arrowStyle(side: Side): React.CSSProperties {
  const S = 5
  const base: React.CSSProperties = { position: 'absolute', width: 0, height: 0 }
  const bg = 'var(--color-deep)'
  switch (side) {
    case 'top':    return { ...base, top: '100%',  left: '50%',  transform: 'translateX(-50%)',
      borderLeft: `${S}px solid transparent`, borderRight: `${S}px solid transparent`, borderTop: `${S}px solid ${bg}` }
    case 'bottom': return { ...base, bottom: '100%', left: '50%', transform: 'translateX(-50%)',
      borderLeft: `${S}px solid transparent`, borderRight: `${S}px solid transparent`, borderBottom: `${S}px solid ${bg}` }
    case 'left':   return { ...base, left: '100%', top: '50%',   transform: 'translateY(-50%)',
      borderTop: `${S}px solid transparent`, borderBottom: `${S}px solid transparent`, borderLeft: `${S}px solid ${bg}` }
    case 'right':  return { ...base, right: '100%', top: '50%',  transform: 'translateY(-50%)',
      borderTop: `${S}px solid transparent`, borderBottom: `${S}px solid transparent`, borderRight: `${S}px solid ${bg}` }
  }
}

// ── Tooltip ────────────────────────────────────────────────────────────────

export function Tooltip({ content, placement = 'auto', delay = 400, disabled, maxWidth = 220, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [side,    setSide]    = useState<Side>('top')
  const wrapRef  = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    if (disabled || !content) return
    timerRef.current = setTimeout(() => {
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect()
        setSide(resolveSide(placement, r))
      }
      setVisible(true)
    }, delay)
  }, [disabled, content, delay, placement])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  const pos = tooltipStyle(side)

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}>
      {children}

      {visible && (
        <span
          role="tooltip"
          style={{
            position:   'absolute',
            zIndex:     9999,
            maxWidth,
            ...pos,
            background: 'var(--color-deep)',
            border:     '1px solid var(--color-border)',
            borderRadius: 8,
            padding:    '6px 10px',
            boxShadow:  '0 4px 16px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            whiteSpace: 'normal',
            animation:  'tt-in 0.12s ease',
          }}>

          {/* Arrow */}
          <span style={arrowStyle(side)} />

          {/* Content */}
          {typeof content === 'string'
            ? <span style={{ fontSize: 10, color: 'var(--color-muted)', lineHeight: 1.5 }}>{content}</span>
            : content
          }
        </span>
      )}

      <style>{`@keyframes tt-in { from { opacity:0; transform: ${pos.transform} scale(0.92) } to { opacity:1; transform: ${pos.transform} scale(1) } }`}</style>
    </span>
  )
}

// ── InfoTooltip — wrapper rapido per icone info ────────────────────────────

export function InfoTooltip({ text, placement }: { text: string; placement?: TooltipPlacement }) {
  return (
    <Tooltip content={text} placement={placement ?? 'top'} delay={200}>
      <span style={{ fontSize: 11, color: 'var(--color-dim)', cursor: 'default',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--color-border)' }}>
        i
      </span>
    </Tooltip>
  )
}
