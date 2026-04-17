'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Summary = { total: number; active: number; offers: number; responseRate: number }
type Phase = { phase: string; avgDays: number }
type Sector = { sector: string; total: number; responded: number; rate: number }
type SalaryPoint = { month: string; avg: number }
type DayCount = { day: string; count: number }

const PHASE_LABEL: Record<string, string> = { sent: 'Invio', viewed: 'Visualizzato', interview: 'Colloquio', offer: 'Offerta' }

function BarChart({ data, label, value, color }: { data: { [k: string]: unknown }[]; label: string; value: string; color: string }) {
  const max = Math.max(...data.map(d => Number(d[value]) || 0), 1)
  const w = 320, h = 140, barW = Math.min(36, (w - 20) / data.length - 4), pad = 20
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 160 }} role="img" aria-label={`Grafico a barre: ${data.length} valori`}>
      {data.map((d, i) => {
        const val = Number(d[value]) || 0
        const barH = (val / max) * (h - pad - 20)
        const x = pad + i * ((w - pad * 2) / data.length) + ((w - pad * 2) / data.length - barW) / 2
        return (
          <g key={i}>
            <rect x={x} y={h - pad - barH} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />
            <text x={x + barW / 2} y={h - pad - barH - 4} textAnchor="middle" fill="var(--color-muted)" fontSize={8}>{val}</text>
            <text x={x + barW / 2} y={h - 6} textAnchor="middle" fill="var(--color-dim)" fontSize={7}>{String(d[label])}</text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ data }: { data: SalaryPoint[] }) {
  if (!data.length) return null
  const w = 320, h = 140, pad = 30
  const vals = data.map(d => d.avg)
  const min = Math.min(...vals) * 0.9, max = Math.max(...vals) * 1.1
  const points = data.map((d, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2)
    const y = h - pad - ((d.avg - min) / (max - min || 1)) * (h - pad * 2)
    return { x, y, ...d }
  })
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 160 }} role="img" aria-label={`Trend stipendio medio: ${data.length} mesi`}>
      <path d={pathD} fill="none" stroke="var(--color-green)" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill="var(--color-green)" />
          <text x={p.x} y={p.y - 8} textAnchor="middle" fill="var(--color-muted)" fontSize={7}>{Math.round(p.avg / 1000)}k</text>
          <text x={p.x} y={h - 6} textAnchor="middle" fill="var(--color-dim)" fontSize={6}>{p.month.slice(5)}</text>
        </g>
      ))}
    </svg>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="px-4 py-3 rounded-lg transition-colors duration-200"
      style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
      <p className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">{label}</p>
      <p className="text-xl font-bold text-[var(--color-white)] mt-1">{value}</p>
      {sub && <p className="text-[9px] text-[var(--color-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function InsightsPage() {
  const [summary, setSummary] = useState<Summary>({ total: 0, active: 0, offers: 0, responseRate: 0 })
  const [phases, setPhases] = useState<Phase[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [salary, setSalary] = useState<SalaryPoint[]>([])
  const [days, setDays] = useState<DayCount[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/insights').catch(() => null)
    if (!res?.ok) { setLoading(false); return }
    const d = await res.json()
    setSummary(d.summary ?? {}); setPhases(d.phaseTimings ?? []); setSectors(d.responseBySector ?? [])
    setSalary(d.salaryTrend ?? []); setDays(d.bestDays ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Insights</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Insights</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Analytics avanzate sulla tua ricerca lavoro</p>
      </div>

      {loading ? (
        <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>
      ) : (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="CANDIDATURE" value={summary.total} />
        <StatCard label="ATTIVE" value={summary.active} />
        <StatCard label="OFFERTE" value={summary.offers} />
        <StatCard label="TASSO RISPOSTA" value={`${summary.responseRate}%`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-lg transition-colors duration-200" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">TEMPO MEDIO PER FASE (GIORNI)</p>
          <BarChart data={phases.map(p => ({ label: PHASE_LABEL[p.phase] ?? p.phase, val: p.avgDays }))} label="label" value="val" color="var(--color-green)" />
        </div>
        <div className="p-4 rounded-lg transition-colors duration-200" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">MIGLIOR GIORNO PER CANDIDARSI</p>
          <BarChart data={days} label="day" value="count" color="#61affe" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg transition-colors duration-200" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">TREND SALARI</p>
          <LineChart data={salary} />
        </div>
        <div className="p-4 rounded-lg transition-colors duration-200" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">TASSO RISPOSTA PER SETTORE</p>
          <BarChart data={sectors.map(s => ({ label: s.sector, val: s.rate }))} label="label" value="val" color="#49cc90" />
        </div>
      </div>
      </>)}
    </div>
  )
}
