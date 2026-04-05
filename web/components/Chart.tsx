'use client'

import { useState } from 'react'

export interface ChartDataPoint { label: string; value: number; color?: string }

interface ChartProps {
  data: ChartDataPoint[]
  width?: number; height?: number
  showLegend?: boolean; showValues?: boolean
}

const PALETTE = ['#00e87a','#60a5fa','#f472b6','#fb923c','#facc15','#a78bfa','#22d3ee','#f87171']
const color   = (d: ChartDataPoint, i: number) => d.color ?? PALETTE[i % PALETTE.length]

/* ── Tooltip ── */
function Tip({ x, y, label, value }: { x: number; y: number; label: string; value: number }) {
  return (
    <g>
      <foreignObject x={x - 40} y={y - 32} width={80} height={26}>
        <div style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 5, padding: '2px 6px', fontSize: 9, color: 'var(--color-bright)', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <b>{label}</b>: {value}
        </div>
      </foreignObject>
    </g>
  )
}

/* ── Legend ── */
function Legend({ data }: { data: ChartDataPoint[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color(d, i), display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'var(--color-dim)' }}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── BarChart ── */
export function BarChart({ data, width = 300, height = 160, showLegend, showValues }: ChartProps) {
  const [tip, setTip] = useState<number | null>(null)
  const pad = 24; const max = Math.max(...data.map(d => d.value), 1)
  const bW  = (width - pad * 2) / data.length
  const bGap = bW * 0.2

  return (
    <div>
      <svg width={width} height={height} style={{ overflow: 'visible' }} role="img" aria-label={`Grafico a barre: ${data.length} valori, max ${max}`}>
        {data.map((d, i) => {
          const bH = ((d.value / max) * (height - pad - 16))
          const x  = pad + i * bW + bGap / 2
          const y  = height - pad - bH
          return (
            <g key={i} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={y} width={bW - bGap} height={bH} rx={3} fill={color(d, i)} opacity={tip === i ? 1 : 0.8} />
              {showValues && <text x={x + (bW - bGap) / 2} y={y - 3} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.value}</text>}
              <text x={x + (bW - bGap) / 2} y={height - 6} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.label}</text>
              {tip === i && <Tip x={x + (bW - bGap) / 2} y={y} label={d.label} value={d.value} />}
            </g>
          )
        })}
      </svg>
      {showLegend && <Legend data={data} />}
    </div>
  )
}

/* ── LineChart ── */
export function LineChart({ data, width = 300, height = 160, showLegend, showValues }: ChartProps) {
  const [tip, setTip] = useState<number | null>(null)
  const pad = 24; const max = Math.max(...data.map(d => d.value), 1)
  const pts = data.map((d, i) => ({
    x: pad + (i / Math.max(data.length - 1, 1)) * (width - pad * 2),
    y: pad + (1 - d.value / max) * (height - pad * 2),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${line} L${pts[pts.length-1].x},${height-pad} L${pts[0].x},${height-pad} Z`
  const c    = color(data[0] ?? {label:'',value:0}, 0)

  return (
    <div>
      <svg width={width} height={height} style={{ overflow: 'visible' }} role="img" aria-label={`Grafico a linee: ${data.length} punti`}>
        <defs>
          <linearGradient id="lg-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.25} />
            <stop offset="100%" stopColor={c} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lg-area)" />
        <path d={line} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)}>
            <circle cx={p.x} cy={p.y} r={tip === i ? 5 : 3} fill={c} stroke="var(--color-panel)" strokeWidth={1.5} style={{ cursor: 'pointer' }} />
            {showValues && <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{data[i].value}</text>}
            <text x={p.x} y={height - 6} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{data[i].label}</text>
            {tip === i && <Tip x={p.x} y={p.y} label={data[i].label} value={data[i].value} />}
          </g>
        ))}
      </svg>
      {showLegend && <Legend data={data} />}
    </div>
  )
}

/* ── PieChart ── */
export function PieChart({ data, width = 160, height = 160, showLegend }: ChartProps) {
  const [tip, setTip] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const cx = width / 2; const cy = height / 2; const r = Math.min(cx, cy) - 8; const ir = r * 0.5

  let angle = -Math.PI / 2
  const arcs = data.map((d, i) => {
    const slice = (d.value / total) * Math.PI * 2
    const a1 = angle; angle += slice; const a2 = angle
    const x1 = cx + r * Math.cos(a1); const y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2); const y2 = cy + r * Math.sin(a2)
    const xi1 = cx + ir * Math.cos(a1); const yi1 = cy + ir * Math.sin(a1)
    const xi2 = cx + ir * Math.cos(a2); const yi2 = cy + ir * Math.sin(a2)
    const large = slice > Math.PI ? 1 : 0
    const mid = a1 + slice / 2
    return { d: `M${xi1},${yi1} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${ir},${ir} 0 ${large} 0 ${xi1},${yi1} Z`, c: color(d, i), mid, tx: cx + (r + 10) * Math.cos(mid), ty: cy + (r + 10) * Math.sin(mid) }
  })

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={width} height={height} role="img" aria-label={`Grafico a torta: ${data.length} fette`}>
        {arcs.map((a, i) => (
          <g key={i} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} style={{ cursor: 'pointer' }}>
            <path d={a.d} fill={a.c} opacity={tip === i ? 1 : 0.82} transform={tip === i ? `translate(${Math.cos(a.mid)*3},${Math.sin(a.mid)*3})` : ''} style={{ transition: 'transform 0.15s' }} />
          </g>
        ))}
        {tip !== null && <Tip x={cx} y={cy + 6} label={data[tip].label} value={data[tip].value} />}
      </svg>
      {showLegend && <Legend data={data} />}
    </div>
  )
}
