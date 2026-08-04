'use client'

export type StatsWidgetProps = {
  label:      string
  value:      string | number
  sub?:       string
  icon?:      string
  color?:     string
  trend?:     { pct: number; direction: 'up' | 'down' | 'neutral'; label?: string }
  sparkline?: number[]
  size?:      'sm' | 'md' | 'lg'
  className?: string
}

// ── Sparkline ──────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const W = 80, H = 28, PAD = 2
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - PAD * 2))
  const ys = data.map(v => H - PAD - ((v - min) / range) * (H - PAD * 2))
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
  const area = `M${xs[0]},${H - PAD} ` + xs.map((x, i) => `L${x},${ys[i]}`).join(' ') + ` L${xs[xs.length - 1]},${H - PAD} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ width: W, height: H, overflow: 'visible', flexShrink: 0 }}>
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace(/[^a-z0-9]/gi, '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2} fill={color} />
    </svg>
  )
}

// ── Trend arrow ────────────────────────────────────────────────────────────
function TrendBadge({ trend }: { trend: NonNullable<StatsWidgetProps['trend']> }) {
  const { pct, direction, label } = trend
  const color = direction === 'up' ? 'var(--color-green)' : direction === 'down' ? 'var(--color-red)' : 'var(--color-dim)'
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold font-mono"
      style={{ color }}>
      {arrow} {Math.abs(pct)}%{label ? ` ${label}` : ''}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export function StatsWidget({
  label, value, sub, icon, color = 'var(--color-green)',
  trend, sparkline, size = 'md', className,
}: StatsWidgetProps) {
  const valueSizes = { sm: 'text-xl', md: 'text-3xl', lg: 'text-4xl' }
  const labelSizes = { sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-[11px]' }
  const pads       = { sm: 'px-3 py-2.5', md: 'px-4 py-3', lg: 'px-5 py-4' }

  return (
    <div className={`flex flex-col gap-2 rounded-xl ${pads[size]} ${className ?? ''}`}
      style={{ border: `1px solid var(--color-border)`, background: 'var(--color-panel)', position: 'relative', overflow: 'hidden' }}>

      {/* Subtle color glow top-left */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 60, height: 60, borderRadius: '50%',
        background: color, opacity: 0.06, filter: 'blur(20px)', pointerEvents: 'none' }} />

      {/* Label row */}
      <div className="flex items-center justify-between gap-2">
        <p className={`${labelSizes[size]} font-bold uppercase tracking-widest`} style={{ color: 'var(--color-dim)' }}>
          {icon && <span className="mr-1">{icon}</span>}{label}
        </p>
        {sparkline && <Sparkline data={sparkline} color={color} />}
      </div>

      {/* Value */}
      <p className={`${valueSizes[size]} font-bold font-mono leading-none`} style={{ color }}>
        {value}
      </p>

      {/* Trend + sub */}
      <div className="flex items-center gap-2 flex-wrap">
        {trend   && <TrendBadge trend={trend} />}
        {sub     && <span className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{sub}</span>}
      </div>
    </div>
  )
}
