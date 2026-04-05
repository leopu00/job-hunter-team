'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { BarChart, LineChart, DataPoint } from '../components/Chart'

type Current = { usage: number; velocity: number; velocity_smooth: number; velocity_ideal: number; projection: number; status: string; throttle: number; delta: number; hours_to_reset: number; ts: string }
type DailyBar = { date: string; peak: number; consumed: number; sessions: number }
type VelPoint = { ts: string; velocity: number; usage: number }

const STATUS_COLOR: Record<string, string> = { OK: 'var(--color-green)', CRITICO: 'var(--color-red)', ATTENZIONE: 'var(--color-yellow)', SOTTOUTILIZZO: 'var(--color-yellow)' }
function sColor(s: string) { for (const [k, v] of Object.entries(STATUS_COLOR)) if (s.startsWith(k)) return v; return 'var(--color-dim)' }

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
      <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--color-dim)' }}>{label}</p>
      <p className="text-2xl font-bold font-mono" style={{ color: color ?? 'var(--color-white)' }}>{value}</p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{sub}</p>}
    </div>
  )
}

function UsageBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full rounded-full h-2" style={{ background: 'var(--color-border)' }}>
      <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

export default function BudgetPage() {
  const [current, setCurrent]   = useState<Current | null>(null)
  const [daily,   setDaily]     = useState<DailyBar[]>([])
  const [velHist, setVelHist]   = useState<VelPoint[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const load = () => fetch('/api/budget').then(r => r.json()).then(d => {
      setCurrent(d.current); setDaily(d.daily ?? []); setVelHist(d.velocity_history ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  const usageColor = !current ? 'var(--color-green)' : current.usage > 80 ? 'var(--color-red)' : current.usage > 60 ? 'var(--color-yellow)' : 'var(--color-green)'
  const barData:  DataPoint[] = daily.map(d => ({ label: d.date.slice(5), value: d.peak }))
  const velData:  DataPoint[] = velHist.map(v => ({ label: v.ts, value: v.velocity }))
  const usageData: DataPoint[] = velHist.map(v => ({ label: v.ts, value: v.usage }))

  return (
    <main className="min-h-screen px-6 py-10" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="max-w-4xl flex flex-col gap-6">

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Budget API</span>
        </nav>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>Budget API</h1>
          </div>
          {current && <span className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: `${sColor(current.status)}18`, color: sColor(current.status), border: `1px solid ${sColor(current.status)}44` }}>
            {current.status}
          </span>}
        </div>

        {loading ? <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        : !current ? <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>Nessun dato.</p>
        : <>
          {/* Usage bar */}
          <div className="flex flex-col gap-2 px-4 py-3 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>Sessione corrente</span>
              <span className="text-[13px] font-mono font-bold" style={{ color: usageColor }}>{current.usage}%</span>
            </div>
            <UsageBar pct={current.usage} color={usageColor} />
            <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>
              Δ {current.delta >= 0 ? '+' : ''}{current.delta}% ultimo tick · reset tra {current.hours_to_reset}h
            </p>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Velocità ist." value={`${current.velocity}%/h`}    color={current.velocity > 30 ? 'var(--color-red)' : 'var(--color-muted)'} />
            <Metric label="Velocità media" value={`${current.velocity_smooth}%/h`} />
            <Metric label="Vel. ideale"   value={`${current.velocity_ideal}%/h`}   color="var(--color-green)" />
            <Metric label="Proiezione"    value={`${current.projection}%`}    color={current.projection > 100 ? 'var(--color-red)' : 'var(--color-green)'} sub="a fine sessione" />
          </div>

          {/* Daily bar chart */}
          {barData.length > 0 && (
            <div className="rounded-xl px-4 pt-4 pb-2 transition-colors duration-200" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
              <p className="text-[9px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--color-dim)' }}>Peak usage giornaliero</p>
              <BarChart data={barData} height={120} color={usageColor} />
            </div>
          )}

          {/* Velocity line chart */}
          {velData.length > 1 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl px-4 pt-4 pb-2 transition-colors duration-200" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                <p className="text-[9px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--color-dim)' }}>Velocità (ultimi 20 tick)</p>
                <LineChart data={velData} height={100} color="var(--color-blue)" showLabels={false} />
              </div>
              <div className="rounded-xl px-4 pt-4 pb-2 transition-colors duration-200" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                <p className="text-[9px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--color-dim)' }}>Usage (ultimi 20 tick)</p>
                <LineChart data={usageData} height={100} color={usageColor} showLabels={false} />
              </div>
            </div>
          )}

          <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Aggiornamento ogni 30s · {velHist.length} campioni nella sessione</p>
        </>}
      </div>
    </main>
  )
}
