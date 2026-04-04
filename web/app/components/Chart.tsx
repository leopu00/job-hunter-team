'use client'

export type DataPoint = { label: string; value: number }

type BaseProps = {
  data: DataPoint[]
  height?: number
  color?: string
  showLabels?: boolean
  showGrid?: boolean
  className?: string
}

const W = 400
const PAD = { top: 16, right: 8, bottom: 28, left: 36 }

function yScale(value: number, min: number, max: number, h: number) {
  if (max === min) return h / 2
  return PAD.top + (1 - (value - min) / (max - min)) * h
}

function xPos(i: number, total: number) {
  const inner = W - PAD.left - PAD.right
  return total === 1 ? PAD.left + inner / 2 : PAD.left + (i / (total - 1)) * inner
}

function GridLines({ min, max, innerH, steps = 4 }: { min: number; max: number; innerH: number; steps?: number }) {
  return <>
    {Array.from({ length: steps + 1 }, (_, i) => {
      const val = min + (i / steps) * (max - min)
      const y   = yScale(val, min, max, innerH)
      return (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={0.5} />
          <text x={PAD.left - 4} y={y + 3} textAnchor="end" fontSize={8} fill="var(--color-dim)">{Math.round(val)}</text>
        </g>
      )
    })}
  </>
}

export function BarChart({ data, height = 160, color = 'var(--color-green)', showLabels = true, showGrid = true, className }: BaseProps) {
  if (!data.length) return null
  const values = data.map(d => d.value)
  const max = Math.max(...values, 1), min = 0
  const innerH = height - PAD.top - PAD.bottom
  const barW   = Math.max(4, (W - PAD.left - PAD.right) / data.length - 4)

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={`w-full ${className ?? ''}`} style={{ overflow: 'visible' }}>
      {showGrid && <GridLines min={min} max={max} innerH={innerH} />}
      {data.map((d, i) => {
        const x   = xPos(i, data.length) - barW / 2
        const y   = yScale(d.value, min, max, innerH)
        const bh  = height - PAD.bottom - y
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(bh, 1)} fill={color} opacity={0.75} rx={2} />
            {showLabels && <text x={xPos(i, data.length)} y={height - PAD.bottom + 10} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

export function LineChart({ data, height = 160, color = 'var(--color-green)', showLabels = true, showGrid = true, className }: BaseProps) {
  if (!data.length) return null
  const values  = data.map(d => d.value)
  const max = Math.max(...values, 1), min = Math.min(...values, 0)
  const innerH  = height - PAD.top - PAD.bottom
  const points  = data.map((d, i) => `${xPos(i, data.length)},${yScale(d.value, min, max, innerH)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={`w-full ${className ?? ''}`} style={{ overflow: 'visible' }}>
      {showGrid && <GridLines min={min} max={max} innerH={innerH} />}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xPos(i, data.length)} cy={yScale(d.value, min, max, innerH)} r={2.5} fill={color} />
          {showLabels && <text x={xPos(i, data.length)} y={height - PAD.bottom + 10} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.label}</text>}
        </g>
      ))}
    </svg>
  )
}

export function AreaChart({ data, height = 160, color = 'var(--color-green)', showLabels = true, showGrid = true, className }: BaseProps) {
  if (!data.length) return null
  const values  = data.map(d => d.value)
  const max = Math.max(...values, 1), min = Math.min(...values, 0)
  const innerH  = height - PAD.top - PAD.bottom
  const baseline = height - PAD.bottom
  const linePoints = data.map((d, i) => `${xPos(i, data.length)},${yScale(d.value, min, max, innerH)}`).join(' ')
  const areaPath = data.length
    ? `M${xPos(0, data.length)},${baseline} ` +
      data.map((d, i) => `L${xPos(i, data.length)},${yScale(d.value, min, max, innerH)}`).join(' ') +
      ` L${xPos(data.length - 1, data.length)},${baseline} Z`
    : ''

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={`w-full ${className ?? ''}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {showGrid && <GridLines min={min} max={max} innerH={innerH} />}
      <path d={areaPath} fill="url(#area-grad)" />
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xPos(i, data.length)} cy={yScale(d.value, min, max, innerH)} r={2.5} fill={color} />
          {showLabels && <text x={xPos(i, data.length)} y={height - PAD.bottom + 10} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.label}</text>}
        </g>
      ))}
    </svg>
  )
}
