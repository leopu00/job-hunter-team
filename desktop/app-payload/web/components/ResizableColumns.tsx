'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ColumnDef {
  id: string
  content: React.ReactNode
  defaultWidth?: number   // px
  minWidth?: number       // px, default 60
  maxWidth?: number       // px, default Infinity
}

export interface ResizableColumnsProps {
  columns: ColumnDef[]
  /** Chiave localStorage per persistenza */
  storageKey?: string
  /** Altezza contenitore — default 'auto' */
  height?: number | string
  gap?: number
}

const HANDLE_W = 6

function loadWidths(key: string, cols: ColumnDef[]): number[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as number[]
      if (parsed.length === cols.length) return parsed
    }
  } catch {}
  return cols.map(c => c.defaultWidth ?? 200)
}

export default function ResizableColumns({ columns, storageKey, height = 'auto', gap = 0 }: ResizableColumnsProps) {
  const storKey = storageKey ?? null
  const [widths, setWidths] = useState<number[]>(() =>
    storKey ? loadWidths(storKey, columns) : columns.map(c => c.defaultWidth ?? 200)
  )

  const dragIdx  = useRef<number | null>(null)
  const startX   = useRef(0)
  const startW   = useRef([0, 0])
  const containerRef = useRef<HTMLDivElement>(null)

  /* Persisti in localStorage */
  useEffect(() => {
    if (storKey) { try { localStorage.setItem(storKey, JSON.stringify(widths)) } catch {} }
  }, [widths, storKey])

  const clampWidth = (col: ColumnDef, w: number) =>
    Math.max(col.minWidth ?? 60, Math.min(col.maxWidth ?? Infinity, w))

  const onMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault()
    dragIdx.current = idx
    startX.current  = e.clientX
    startW.current  = [widths[idx], widths[idx + 1]]

    const onMove = (ev: MouseEvent) => {
      if (dragIdx.current === null) return
      const i    = dragIdx.current
      const dx   = ev.clientX - startX.current
      const colA = columns[i], colB = columns[i + 1]
      const wA   = clampWidth(colA, startW.current[0] + dx)
      const wB   = clampWidth(colB, startW.current[1] - dx)
      setWidths(prev => { const n = [...prev]; n[i] = wA; n[i + 1] = wB; return n })
    }
    const onUp = () => {
      dragIdx.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [widths, columns])

  /* Touch support */
  const onTouchStart = useCallback((e: React.TouchEvent, idx: number) => {
    dragIdx.current = idx
    startX.current  = e.touches[0].clientX
    startW.current  = [widths[idx], widths[idx + 1]]

    const onMove = (ev: TouchEvent) => {
      if (dragIdx.current === null) return
      const i  = dragIdx.current
      const dx = ev.touches[0].clientX - startX.current
      const wA = clampWidth(columns[i],     startW.current[0] + dx)
      const wB = clampWidth(columns[i + 1], startW.current[1] - dx)
      setWidths(prev => { const n = [...prev]; n[i] = wA; n[i + 1] = wB; return n })
    }
    const onEnd = () => {
      dragIdx.current = null
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
  }, [widths, columns])

  const resetWidths = () => {
    const def = columns.map(c => c.defaultWidth ?? 200)
    setWidths(def)
    if (storKey) { try { localStorage.removeItem(storKey) } catch {} }
  }

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', height, overflow: 'hidden', gap }}
    >
      {columns.map((col, i) => (
        <div key={col.id} style={{ display: 'flex', flexShrink: 0 }}>
          {/* Colonna */}
          <div style={{
            width: widths[i], minWidth: col.minWidth ?? 60,
            maxWidth: col.maxWidth,
            overflow: 'hidden', flexShrink: 0,
          }}>
            {col.content}
          </div>

          {/* Handle (non dopo l'ultima colonna) */}
          {i < columns.length - 1 && (
            <div
              onMouseDown={e => onMouseDown(e, i)}
              onTouchStart={e => onTouchStart(e, i)}
              onDoubleClick={resetWidths}
              title="Trascina per ridimensionare — doppio click per reset"
              style={{
                width: HANDLE_W, flexShrink: 0,
                cursor: 'col-resize',
                background: 'var(--color-border)',
                position: 'relative',
                transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-green,#00e87a)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-border)')}
            >
              {/* Grip dots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
                {[0,1,2].map(d => (
                  <div key={d} style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--color-dim)' }} />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
