'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type KPI = { totalApplications: number; responseRate: number; avgResponseDays: number; interviewsScheduled: number }
type TimelinePoint = { date: string; count: number }
type StatusItem = { status: string; count: number }
type CompanyItem = { company: string; count: number }
type RateTrend = { date: string; rate: number }
type Data = { jobHunting: { kpi: KPI; timeline: TimelinePoint[]; statusBreakdown: StatusItem[]; topCompanies: CompanyItem[]; responseRateTrend: RateTrend[] } }

const STATUS_COLORS: Record<string, string> = {
  applied: '#61affe', screening: '#fca130', interview: 'var(--color-yellow)',
  offer: 'var(--color-green)', rejected: 'var(--color-red)', withdrawn: 'var(--color-dim)',
}

function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function LineChart({ data }: { data: TimelinePoint[] }) {
  if (data.length < 2) return <p className="text-[var(--color-dim)] text-center py-8 text-[11px]">Dati insufficienti</p>
  const max = Math.max(...data.map(d => d.count), 1)
  const W = 500, H = 120, pad = 20
  const points = data.map((d, i) => ({ x: pad + (i / (data.length - 1)) * (W - 2 * pad), y: H - pad - (d.count / max) * (H - 2 * pad) }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} role="img" aria-label={`Candidature nel tempo: ${data.length} punti`}>
      {points.map((p, i) => i % Math.ceil(data.length / 6) === 0 && (
        <text key={i} x={p.x} y={H - 2} textAnchor="middle" fontSize="8" fill="var(--color-dim)">{data[i].date.slice(5)}</text>
      ))}
      <path d={path} fill="none" stroke="var(--color-green)" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--color-green)" />)}
    </svg>
  )
}

function PieChart({ data }: { data: StatusItem[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return null
  const CX = 70, CY = 70, R = 60
  let angle = -Math.PI / 2
  const slices = data.map(d => {
    const pct = d.count / total
    const start = angle
    angle += pct * 2 * Math.PI
    const end = angle
    const large = pct > 0.5 ? 1 : 0
    const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start)
    const x2 = CX + R * Math.cos(end), y2 = CY + R * Math.sin(end)
    return { ...d, pct, path: `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z` }
  })
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140 }} role="img" aria-label={`Distribuzione stati: ${data.length} categorie`}>
        {slices.map(s => <path key={s.status} d={s.path} fill={STATUS_COLORS[s.status] ?? 'var(--color-dim)'} opacity="0.85" />)}
      </svg>
      <div className="space-y-1.5">
        {slices.map(s => (
          <div key={s.status} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: STATUS_COLORS[s.status] ?? 'var(--color-dim)' }} />
            <span className="text-[10px] text-[var(--color-muted)] w-16">{s.status}</span>
            <span className="text-[10px] font-bold text-[var(--color-bright)]">{s.count}</span>
            <span className="text-[9px] text-[var(--color-dim)]">({(s.pct * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChartH({ data }: { data: CompanyItem[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="space-y-2">
      {data.map(d => (
        <div key={d.company} className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--color-muted)] w-20 text-right truncate">{d.company}</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden bg-[var(--color-border)]">
            <div className="h-full rounded-sm" style={{ width: `${(d.count / max) * 100}%`, background: '#61affe', opacity: 0.8 }} />
          </div>
          <span className="text-[10px] font-bold text-[var(--color-bright)] w-6 text-right">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [days, setDays] = useState(30)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/analytics?days=${days}`).catch(() => null)
    if (res?.ok) setData(await res.json())
  }, [days])

  useEffect(() => { fetchData() }, [fetchData])

  const jh = data?.jobHunting
  const PERIODS = [{ v: 7, l: '7g' }, { v: 30, l: '30g' }, { v: 90, l: '90g' }]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Analytics</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Analytics</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Dashboard candidature — ultimi {days} giorni</p>
          </div>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.v} onClick={() => setDays(p.v)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
                style={{ background: days === p.v ? 'var(--color-row)' : 'transparent', color: days === p.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${days === p.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {p.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!jh ? <p className="text-[var(--color-dim)] text-center py-16 text-[12px] animate-pulse">Caricamento...</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KPICard label="Candidature" value={String(jh.kpi.totalApplications)} color="var(--color-bright)" />
            <KPICard label="Response Rate" value={`${jh.kpi.responseRate}%`} color="var(--color-green)" />
            <KPICard label="Tempo Risposta" value={`${jh.kpi.avgResponseDays}g`} sub="media giorni" color="var(--color-yellow)" />
            <KPICard label="Colloqui" value={String(jh.kpi.interviewsScheduled)} color="#61affe" />
          </div>

          <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Candidature nel tempo</p>
            <LineChart data={jh.timeline} />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Per stato</p>
              <PieChart data={jh.statusBreakdown} />
            </div>
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Top aziende</p>
              <BarChartH data={jh.topCompanies} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
