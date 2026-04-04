'use client'

import { useEffect, useRef, useState } from 'react'

export interface AnalyticsData {
  weekly: Array<{ label: string; count: number }>
  funnel: { applied: number; screening: number; interview: number; offer: number }
  topCompanies: Array<{ name: string; count: number }>
}

/* --- Weekly Bar Chart --- */
function WeeklyChart({ data }: { data: AnalyticsData['weekly'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(300)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => { if (e) setW(e.contentRect.width) })
    ro.observe(el); setW(el.offsetWidth); return () => ro.disconnect()
  }, [])

  const H = 80, pad = { t: 8, b: 20, l: 4, r: 4 }
  const chartH = H - pad.t - pad.b
  const max = Math.max(...data.map(d => d.count), 1)
  const bw = (w - pad.l - pad.r) / data.length - 4

  return (
    <div ref={ref} className="w-full">
      <svg width="100%" height={H}>
        {data.map((d, i) => {
          const bh = (d.count / max) * chartH
          const x  = pad.l + i * ((w - pad.l - pad.r) / data.length) + 2
          const y  = pad.t + chartH - bh
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={bh} rx={2}
                fill={i === data.length - 1 ? 'var(--color-green)' : 'rgba(0,232,122,0.3)'} />
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{d.label}</text>
              {d.count > 0 && <text x={x + bw / 2} y={y - 2} textAnchor="middle" fontSize={8} fill="var(--color-green)">{d.count}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* --- Conversion Funnel --- */
function Funnel({ data }: { data: AnalyticsData['funnel'] }) {
  const steps = [
    { label: 'Candidati',  value: data.applied,    color: 'var(--color-muted)' },
    { label: 'Screening',  value: data.screening,  color: 'var(--color-yellow)' },
    { label: 'Colloquio',  value: data.interview,  color: 'var(--color-green)' },
    { label: 'Offerta',    value: data.offer,       color: '#f59e0b' },
  ]
  const max = data.applied || 1
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const pct  = Math.round((s.value / max) * 100)
        const conv = i > 0 ? Math.round((s.value / (steps[i - 1]!.value || 1)) * 100) : 100
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] font-mono" style={{ color: s.color }}>{s.label}</span>
              <div className="flex items-center gap-2">
                {i > 0 && <span className="text-[8px] text-[var(--color-dim)]">↓{conv}%</span>}
                <span className="text-[10px] font-bold" style={{ color: s.color }}>{s.value}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* --- Top Companies --- */
function TopCompanies({ data }: { data: AnalyticsData['topCompanies'] }) {
  const max = Math.max(...data.map(c => c.count), 1)
  return (
    <div className="flex flex-col gap-1.5">
      {data.slice(0, 5).map((c, i) => (
        <div key={c.name} className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-[var(--color-dim)] w-3 flex-shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-[var(--color-muted)] truncate">{c.name}</span>
              <span className="text-[9px] font-mono text-[var(--color-green)] ml-2 flex-shrink-0">{c.count}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div className="h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, background: 'rgba(0,232,122,0.4)' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* --- Main Dashboard --- */
export default function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const panels = [
    { title: 'Candidature settimanali', content: <WeeklyChart data={data.weekly} /> },
    { title: 'Conversion funnel',       content: <Funnel data={data.funnel} /> },
    { title: 'Top aziende',             content: <TopCompanies data={data.topCompanies} /> },
  ]
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {panels.map(p => (
        <div key={p.title} className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">{p.title}</p>
          {p.content}
        </div>
      ))}
    </div>
  )
}
