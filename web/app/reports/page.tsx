'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type MonthData = { month: string; sent: number; responses: number }
type PhaseTime = { phase: string; avgDays: number }
type TopCompany = { company: string; applications: number; responses: number }
type KPI = { totalApplications: number; responseRate: number; interviewsScheduled: number; offersReceived: number; avgResponseDays: number }
type Period = '30d' | '90d' | '6m'

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [kpi, setKpi] = useState<KPI | null>(null)
  const [monthly, setMonthly] = useState<MonthData[]>([])
  const [phases, setPhases] = useState<PhaseTime[]>([])
  const [companies, setCompanies] = useState<TopCompany[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/reports?period=${period}`).catch(() => null)
    if (!res?.ok) { setLoading(false); return }
    const data = await res.json()
    setKpi(data.kpi ?? null); setMonthly(data.monthly ?? [])
    setPhases(data.phaseTimes ?? []); setCompanies(data.topCompanies ?? [])
    setLoading(false)
  }, [period])

  useEffect(() => { fetchData() }, [fetchData])

  const maxSent = Math.max(...monthly.map(m => m.sent), 1)
  const maxPhase = Math.max(...phases.map(p => p.avgDays), 1)
  const maxApps = Math.max(...companies.map(c => c.applications), 1)
  const PERIODS: Array<{ key: Period; label: string }> = [{ key: '30d', label: '30 giorni' }, { key: '90d', label: '90 giorni' }, { key: '6m', label: '6 mesi' }]

  const KPI_CARDS: Array<{ label: string; value: string; color: string }> = kpi ? [
    { label: 'Candidature', value: String(kpi.totalApplications), color: '#61affe' },
    { label: 'Tasso risposta', value: `${kpi.responseRate}%`, color: 'var(--color-green)' },
    { label: 'Colloqui', value: String(kpi.interviewsScheduled), color: 'var(--color-yellow)' },
    { label: 'Offerte', value: String(kpi.offersReceived), color: 'var(--color-green)' },
    { label: 'Tempo risposta', value: `${kpi.avgResponseDays}g`, color: 'var(--color-muted)' },
  ] : []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Report</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Report</h1>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
                style={{ background: period === p.key ? 'var(--color-row)' : 'transparent', color: period === p.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${period === p.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>
      ) : (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {KPI_CARDS.map((k, i) => (
          <div key={k.label} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] transition-all duration-200 hover:border-[var(--color-border-glow)]"
            style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}>
            <p className="text-[9px] uppercase tracking-widest text-[var(--color-dim)]">{k.label}</p>
            <p className="text-xl font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">Candidature per mese</p>
          {monthly.map(m => (
            <div key={m.month} className="flex items-center gap-2 mb-2">
              <span className="text-[9px] text-[var(--color-dim)] w-16">{m.month}</span>
              <Bar value={m.sent} max={maxSent} color="#61affe" />
              <span className="text-[10px] font-bold text-[var(--color-bright)] w-8 text-right">{m.sent}</span>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">Tempo medio per fase</p>
          {phases.map(p => (
            <div key={p.phase} className="flex items-center gap-2 mb-2">
              <span className="text-[9px] text-[var(--color-dim)] w-28 truncate">{p.phase}</span>
              <Bar value={p.avgDays} max={maxPhase} color="var(--color-yellow)" />
              <span className="text-[10px] font-bold text-[var(--color-bright)] w-10 text-right">{p.avgDays}g</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">Top aziende</p>
        {companies.map(c => {
          const rate = c.applications > 0 ? Math.round((c.responses / c.applications) * 100) : 0
          return (
            <div key={c.company} className="flex items-center gap-3 mb-2">
              <span className="text-[11px] font-semibold text-[var(--color-bright)] w-36 truncate">{c.company}</span>
              <Bar value={c.applications} max={maxApps} color="var(--color-green)" />
              <span className="text-[9px] text-[var(--color-muted)] w-20 text-right">{c.applications} inv · {rate}%</span>
            </div>
          )
        })}
      </div>
      </>)}
    </div>
  )
}
