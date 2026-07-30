'use client'

import { Children, useEffect, useRef, useState } from 'react'

export interface MasonryColumns {
  sm?: number   // < 640px
  md?: number   // < 1024px
  lg?: number   // >= 1024px
}

export interface MasonryProps {
  children: React.ReactNode
  /** Numero colonne fisso o responsive */
  columns?: number | MasonryColumns
  gap?: number
  className?: string
}

function useColumns(columns: number | MasonryColumns): number {
  const getCount = (w: number): number => {
    if (typeof columns === 'number') return columns
    const { sm = 1, md = 2, lg = 3 } = columns
    if (w < 640)  return sm
    if (w < 1024) return md
    return lg
  }
  const [cols, setCols] = useState(() =>
    typeof window !== 'undefined' ? getCount(window.innerWidth) : (typeof columns === 'number' ? columns : 3)
  )
  useEffect(() => {
    const update = () => setCols(getCount(window.innerWidth))
    window.addEventListener('resize', update)
    update()
    return () => window.removeEventListener('resize', update)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return cols
}

export default function Masonry({ children, columns = { sm: 1, md: 2, lg: 3 }, gap = 16, className }: MasonryProps) {
  const cols     = useColumns(columns)
  const items    = Children.toArray(children)
  const refs     = useRef<(HTMLDivElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<number[]>([])
  const [ready, setReady]     = useState(false)

  // Misuriamo le altezze degli item dopo il render
  useEffect(() => {
    // Render invisibile per misurare
    const measured = refs.current.map(el => el?.offsetHeight ?? 0)
    setHeights(measured)
    setReady(true)
  }, [items.length, cols])

  // Ricalcola su resize
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const measured = refs.current.map(el => el?.offsetHeight ?? 0)
      setHeights(measured)
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Distribuisce item nelle colonne (colonna più corta per prima)
  const colItems = Array.from({ length: cols }, () => [] as number[])
  const colHeights = Array(cols).fill(0)

  items.forEach((_, i) => {
    const shortest = colHeights.indexOf(Math.min(...colHeights))
    colItems[shortest].push(i)
    colHeights[shortest] += (heights[i] ?? 200) + gap
  })

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap,
        alignItems: 'start',
        // Phase 1: invisibile per misurare, Phase 2: visibile
        opacity: ready ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}>
      {/* Rendiamo per colonna in order visivo — ma CSS grid gestisce il layout */}
      {Array.from({ length: cols }, (_, colIdx) => (
        <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap }}>
          {colItems[colIdx].map(itemIdx => (
            <div
              key={itemIdx}
              ref={el => { refs.current[itemIdx] = el }}>
              {items[itemIdx]}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Hook useBreakpoint — utile anche standalone ── */
export function useBreakpoint(): 'sm' | 'md' | 'lg' {
  const [bp, setBp] = useState<'sm'|'md'|'lg'>('lg')
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setBp(w < 640 ? 'sm' : w < 1024 ? 'md' : 'lg')
    }
    window.addEventListener('resize', update)
    update()
    return () => window.removeEventListener('resize', update)
  }, [])
  return bp
}
