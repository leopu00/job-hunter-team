'use client'

import { useEffect, useRef, useState } from 'react'

export interface SalaryEntry {
  label: string          // es. "Frontend Senior", "Backend Mid"
  min: number
  max: number
  /** Valore offerto al candidato (opzionale) */
  offer?: number
  /** Se true: evidenzia come media mercato */
  isMarket?: boolean
}

export interface SalaryChartProps {
  entries: SalaryEntry[]
  currency?: string
  period?: 'year' | 'month'
  title?: string
}

function fmtK(n: number, currency: string): string {
  return `${currency}${(n / 1000).toFixed(0)}k`
}

const BAR_HEIGHT  = 28
const BAR_GAP     = 14
const LABEL_WIDTH = 140
const PADDING     = { top: 16, right: 64, bottom: 32, left: 16 }

export default function SalaryChart({ entries, currency = '€', period = 'year', title }: SalaryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth]   = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.offsetWidth)
    return () => ro.disconnect()
  }, [])

  if (entries.length === 0) return null

  const globalMin = Math.min(...entries.map(e => e.min)) * 0.9
  const globalMax = Math.max(...entries.map(e => e.max)) * 1.05

  const chartW = Math.max(width - LABEL_WIDTH - PADDING.left - PADDING.right, 100)
  const chartH = entries.length * (BAR_HEIGHT + BAR_GAP) - BAR_GAP
  const svgH   = chartH + PADDING.top + PADDING.bottom

  function xPct(val: number): number {
    return ((val - globalMin) / (globalMax - globalMin)) * chartW
  }

  // Tick values
  const tickCount = 5
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    globalMin + (i / (tickCount - 1)) * (globalMax - globalMin)
  )

  const offsetX = LABEL_WIDTH + PADDING.left

  return (
    <div ref={containerRef} className="w-full">
      {title && <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">{title}</p>}
      <svg width="100%" height={svgH} style={{ overflow: 'visible', display: 'block' }} role="img" aria-label={`Confronto stipendi: ${entries.length} ruoli, ${period === 'year' ? 'annuo' : 'mensile'}`}>

        {/* Tick lines + labels asse X */}
        {ticks.map((t, i) => {
          const x = offsetX + xPct(t)
          return (
            <g key={i}>
              <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + chartH}
                stroke="var(--color-border)" strokeWidth={1} strokeDasharray="3,3" />
              <text x={x} y={svgH - 6} textAnchor="middle" fontSize={8} fill="var(--color-dim)">
                {fmtK(t, currency)}
              </text>
            </g>
          )
        })}

        {entries.map((entry, i) => {
          const y       = PADDING.top + i * (BAR_HEIGHT + BAR_GAP)
          const xMin    = xPct(entry.min)
          const xMax    = xPct(entry.max)
          const barW    = xMax - xMin
          const isMarket = entry.isMarket

          return (
            <g key={entry.label}>
              {/* Etichetta riga */}
              <text x={PADDING.left + LABEL_WIDTH - 8} y={y + BAR_HEIGHT / 2 + 4}
                textAnchor="end" fontSize={10} fill={isMarket ? 'var(--color-yellow)' : 'var(--color-muted)'} fontWeight={isMarket ? 600 : 400}>
                {entry.label}
              </text>

              {/* Bar background (range min→max) */}
              <rect x={offsetX + xMin} y={y} width={barW} height={BAR_HEIGHT} rx={4}
                fill={isMarket ? 'rgba(245,197,24,0.15)' : 'rgba(0,232,122,0.1)'}
                stroke={isMarket ? 'rgba(245,197,24,0.4)' : 'rgba(0,232,122,0.25)'} strokeWidth={1} />

              {/* Linea min */}
              <line x1={offsetX + xMin} y1={y + 4} x2={offsetX + xMin} y2={y + BAR_HEIGHT - 4}
                stroke={isMarket ? 'var(--color-yellow)' : 'var(--color-green)'} strokeWidth={2} />
              {/* Linea max */}
              <line x1={offsetX + xMax} y1={y + 4} x2={offsetX + xMax} y2={y + BAR_HEIGHT - 4}
                stroke={isMarket ? 'var(--color-yellow)' : 'var(--color-green)'} strokeWidth={2} />

              {/* Offer marker */}
              {entry.offer !== undefined && (
                <>
                  <circle cx={offsetX + xPct(entry.offer)} cy={y + BAR_HEIGHT / 2} r={5}
                    fill="var(--color-orange)" stroke="#000" strokeWidth={1.5} />
                  <text x={offsetX + xPct(entry.offer)} y={y - 3}
                    textAnchor="middle" fontSize={8} fill="var(--color-orange)" fontWeight={600}>
                    {fmtK(entry.offer, currency)}
                  </text>
                </>
              )}

              {/* Min/max labels */}
              <text x={offsetX + xMin - 3} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end"
                fontSize={8} fill="var(--color-dim)">{fmtK(entry.min, currency)}</text>
              <text x={offsetX + xMax + 3} y={y + BAR_HEIGHT / 2 + 4} textAnchor="start"
                fontSize={8} fill="var(--color-dim)">{fmtK(entry.max, currency)}</text>
            </g>
          )
        })}
      </svg>

      {/* Legenda */}
      <div className="flex items-center gap-4 mt-1 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-2 rounded" style={{ background: 'rgba(0,232,122,0.3)', border: '1px solid rgba(0,232,122,0.4)' }} />
          <span className="text-[9px] text-[var(--color-dim)]">range offerta</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-2 rounded" style={{ background: 'rgba(245,197,24,0.2)', border: '1px solid rgba(245,197,24,0.4)' }} />
          <span className="text-[9px] text-[var(--color-dim)]">media mercato</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: 'var(--color-orange)', border: '1.5px solid #000' }} />
          <span className="text-[9px] text-[var(--color-dim)]">offerta candidato · {period === 'year' ? 'annuo' : 'mensile'}</span>
        </div>
      </div>
    </div>
  )
}
