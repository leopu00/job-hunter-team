'use client'

export type Trend = 'up' | 'down' | 'neutral'

type Props = {
  title: string
  value: string | number
  unit?: string
  trend?: Trend
  trendValue?: string
  trendLabel?: string
  icon?: string
  color?: string
  loading?: boolean
}

const TREND_CFG: Record<Trend, { arrow: string; color: string }> = {
  up:      { arrow: '↑', color: 'var(--color-green)' },
  down:    { arrow: '↓', color: 'var(--color-red)' },
  neutral: { arrow: '→', color: 'var(--color-dim)' },
}

export function MetricCard({ title, value, unit, trend, trendValue, trendLabel, icon, color, loading }: Props) {
  const accentColor = color ?? 'var(--color-green)'
  const trendCfg = trend ? TREND_CFG[trend] : null

  return (
    <div className="flex flex-col gap-3 px-5 py-4 rounded-lg border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)', position: 'relative', overflow: 'hidden' }}>

      {/* Glow accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accentColor, opacity: 0.5 }} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{title}</p>
        {icon && <span className="text-base" style={{ opacity: 0.6 }}>{icon}</span>}
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-1.5">
        {loading
          ? <div className="h-7 w-16 rounded animate-pulse" style={{ background: 'var(--color-card)' }} />
          : <>
              <span className="text-3xl font-bold tracking-tight" style={{ color: 'var(--color-white)', lineHeight: 1 }}>{value}</span>
              {unit && <span className="text-[11px]" style={{ color: 'var(--color-dim)' }}>{unit}</span>}
            </>
        }
      </div>

      {/* Trend */}
      {trendCfg && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <span style={{ color: trendCfg.color }}>{trendCfg.arrow}</span>
          {trendValue && <span className="font-mono font-semibold" style={{ color: trendCfg.color }}>{trendValue}</span>}
          {trendLabel && <span style={{ color: 'var(--color-dim)' }}>{trendLabel}</span>}
        </div>
      )}
    </div>
  )
}
