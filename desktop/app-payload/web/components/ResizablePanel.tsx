'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ResizeDirection = 'horizontal' | 'vertical'

export interface ResizablePanelProps {
  /** Primo pannello */
  first: React.ReactNode
  /** Secondo pannello */
  second: React.ReactNode
  direction?: ResizeDirection
  /** Dimensione iniziale del primo pannello in % (default 50) */
  defaultSize?: number
  /** Min % primo pannello (default 15) */
  minSize?: number
  /** Max % primo pannello (default 85) */
  maxSize?: number
  onResize?: (size: number) => void
  /** Altezza totale per direction=vertical */
  height?: number | string
  className?: string
}

export default function ResizablePanel({
  first,
  second,
  direction = 'horizontal',
  defaultSize = 50,
  minSize = 15,
  maxSize = 85,
  onResize,
  height = '100%',
  className,
}: ResizablePanelProps) {
  const [size, setSize]       = useState(defaultSize)
  const [dragging, setDragging] = useState(false)
  const containerRef           = useRef<HTMLDivElement>(null)
  const isH                    = direction === 'horizontal'

  const clamp = (v: number) => Math.min(maxSize, Math.max(minSize, v))

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (ev: MouseEvent) => {
      const pct = isH
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : ((ev.clientY - rect.top) / rect.height) * 100
      const clamped = clamp(pct)
      setSize(clamped)
      onResize?.(clamped)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isH, minSize, maxSize, onResize])

  // Touch support
  const startResizeTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    setDragging(true)
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (ev: TouchEvent) => {
      const touch = ev.touches[0]
      const pct = isH
        ? ((touch.clientX - rect.left) / rect.width) * 100
        : ((touch.clientY - rect.top) / rect.height) * 100
      const clamped = clamp(pct)
      setSize(clamped)
      onResize?.(clamped)
    }
    const onEnd = () => {
      setDragging(false)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
  }, [isH, minSize, maxSize, onResize])

  // Blocca selezione testo durante drag
  useEffect(() => {
    document.body.style.userSelect = dragging ? 'none' : ''
    document.body.style.cursor     = dragging ? (isH ? 'col-resize' : 'row-resize') : ''
    return () => { document.body.style.userSelect = ''; document.body.style.cursor = '' }
  }, [dragging, isH])

  /* ── Stili ── */
  const containerStyle: React.CSSProperties = {
    display: 'flex', flexDirection: isH ? 'row' : 'column',
    height: isH ? height : height, width: '100%', overflow: 'hidden',
  }
  const firstStyle: React.CSSProperties = {
    [isH ? 'width' : 'height']: `${size}%`,
    flexShrink: 0, overflow: 'auto', minWidth: 0, minHeight: 0,
  }
  const secondStyle: React.CSSProperties = {
    flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0,
  }

  const handleStyle: React.CSSProperties = {
    flexShrink: 0,
    [isH ? 'width' : 'height']: 6,
    [isH ? 'height' : 'width']: '100%',
    background: dragging ? 'var(--color-green)' : 'var(--color-border)',
    cursor: isH ? 'col-resize' : 'row-resize',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s',
    position: 'relative', zIndex: 1,
    flexDirection: isH ? 'column' : 'row',
    gap: 2,
  }

  /* ── Grip lines ── */
  const gripLines = Array.from({ length: 3 }).map((_, i) => (
    <div key={i} style={{
      [isH ? 'width' : 'height']: 1,
      [isH ? 'height' : 'width']: 12,
      borderRadius: 1,
      background: dragging ? '#000' : 'var(--color-muted)',
      opacity: 0.6,
    }} />
  ))

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      <div style={firstStyle}>{first}</div>

      {/* Handle */}
      <div
        style={handleStyle}
        onMouseDown={startResize}
        onTouchStart={startResizeTouch}
        onDoubleClick={() => { setSize(defaultSize); onResize?.(defaultSize) }}
        onMouseEnter={e => { if (!dragging) e.currentTarget.style.background = 'rgba(0,232,122,0.4)' }}
        onMouseLeave={e => { if (!dragging) e.currentTarget.style.background = 'var(--color-border)' }}>
        {gripLines}
      </div>

      <div style={secondStyle}>{second}</div>
    </div>
  )
}
