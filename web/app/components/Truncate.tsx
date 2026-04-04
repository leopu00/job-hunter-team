'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TruncateProps {
  children:       string
  lines?:         number        // righe massime, default 3
  expandable?:    boolean       // mostra link "Mostra di più", default true
  showTooltip?:   boolean       // tooltip con testo completo su hover (quando collapsed)
  expandLabel?:   string
  collapseLabel?: string
  className?:     string
  style?:         CSSProperties
}

// ── Truncate ───────────────────────────────────────────────────────────────

export function Truncate({
  children, lines = 3, expandable = true, showTooltip = true,
  expandLabel = 'Mostra di più', collapseLabel = 'Mostra meno',
  className = '', style,
}: TruncateProps) {
  const ref              = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded]   = useState(false)
  const [clamped, setClamped]     = useState(false)
  const [tip, setTip]             = useState(false)

  // Rileva se il testo è effettivamente troncato
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children, lines])

  const clampStyle: CSSProperties = !expanded ? {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } : {}

  const showLink = expandable && clamped
  const tipVisible = showTooltip && !expanded && clamped && tip

  return (
    <div className={`relative ${className}`} style={style}>
      {/* Tooltip testo completo */}
      {tipVisible && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 30,
          marginBottom: 6, maxWidth: 320, maxHeight: 200, overflowY: 'auto',
          background: 'var(--color-deep)', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '8px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          pointerEvents: 'none' }}>
          <span style={{ fontSize: 10, color: 'var(--color-base)',
            fontFamily: 'var(--font-mono)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {children}
          </span>
        </div>
      )}

      {/* Testo */}
      <div
        ref={ref}
        style={clampStyle}
        onMouseEnter={showTooltip && !expanded ? () => setTip(true)  : undefined}
        onMouseLeave={showTooltip             ? () => setTip(false) : undefined}
      >
        {children}
      </div>

      {/* Expand / collapse */}
      {showLink && (
        <button type="button" onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
            fontSize: 10, color: 'var(--color-green)', fontFamily: 'var(--font-mono)',
            fontWeight: 600, display: 'inline-block', marginTop: 2, transition: 'opacity .15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}>
          {expanded ? collapseLabel : expandLabel}
        </button>
      )}
    </div>
  )
}

// ── TruncateCell — versione compatta per tabelle ───────────────────────────

export interface TruncateCellProps {
  children: string
  maxWidth?: number    // px max-width cella, default 240
  lines?:   number
}

export function TruncateCell({ children, maxWidth = 240, lines = 1 }: TruncateCellProps) {
  const [tip, setTip] = useState(false)
  const ref           = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflow(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
  }, [children])

  const cellStyle: CSSProperties = lines === 1 ? {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth, display: 'inline-block',
  } : {
    display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical',
    overflow: 'hidden', maxWidth,
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {tip && overflow && (
        <span style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 30,
          marginBottom: 4, background: 'var(--color-deep)', border: '1px solid var(--color-border)',
          borderRadius: 4, padding: '3px 8px', whiteSpace: 'pre-wrap', maxWidth: 300,
          pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.35)' }}>
          <span style={{ fontSize: 9, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>
            {children}
          </span>
        </span>
      )}
      <span ref={ref} style={cellStyle}
        onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}
        title={overflow ? children : undefined}>
        {children}
      </span>
    </span>
  )
}

// ── useTruncated — hook per rilevare overflow su ref esterno ──────────────

export function useTruncated(text: string): [React.RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement>(null)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setTruncated(el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 1)
  }, [text])
  return [ref, truncated]
}
