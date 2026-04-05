'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { AreaChart, DataPoint } from '../components/Chart'

type UsageCurrent = { usage: number; delta: number; velocity: number; throttle: number; projection: number; ts: string; status: string }
type HistPoint    = { ts: string; usage: number; velocity: number; throttle: number; projection: number }
type Order        = { ts: string; text: string }

const STATUS_COLOR: Record<string, string> = {
  'OK':              'var(--color-green)',
  'CRITICO':         'var(--color-red)',
  'SOTTOUTILIZZO':   'var(--color-yellow)',
}

function statusColor(s: string) {
  for (const [k, v] of Object.entries(STATUS_COLOR)) if (s.startsWith(k)) return v
  return 'var(--color-dim)'
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
      <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--color-dim)' }}>{label}</p>
      <p className="text-2xl font-bold font-mono" style={{ color: color ?? 'var(--color-white)' }}>{value}</p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{sub}</p>}
    </div>
  )
}

function OrderRow({ o }: { o: Order }) {
  const isSlow  = o.text.includes('RALLENTARE')
  const isAccel = o.text.includes('ACCELERARE')
  const color   = isSlow ? 'var(--color-red)' : isAccel ? 'var(--color-green)' : 'var(--color-muted)'
  return (
    <div className="flex gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--color-dim)', minWidth: 80 }}>
        {o.ts.slice(11, 19)}
      </span>
      <span className="text-[10px]" style={{ color }}>{o.text}</span>
    </div>
  )
}

export default function SentinelPage() {
  const [current,   setCurrent]   = useState<UsageCurrent | null>(null)
  const [history,   setHistory]   = useState<HistPoint[]>([])
  const [orders,    setOrders]    = useState<Order[]>([])
  const [nextReset, setNextReset] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const load = () => fetch('/api/sentinel').then(r => r.json()).then(d => {
      setCurrent(d.current); setHistory(d.history ?? [])
      setOrders(d.orders ?? []); setNextReset(d.next_reset)
      setLoading(false)
    }).catch(() => setLoading(false))
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  const chartData: DataPoint[] = history.map(h => ({
    label: h.ts.slice(11, 16),
    value: h.usage,
  }))

  const usageColor = !current ? 'var(--color-green)'
    : current.usage > 80 ? 'var(--color-red)'
    : current.usage > 60 ? 'var(--color-yellow)'
    : 'var(--color-green)'

  return (
    <main className="min-h-screen px-6 py-10" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="max-w-4xl flex flex-col gap-6">

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Sentinel</span>
        </nav>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>Sentinel — Vigil</h1>
          </div>
          {current && (
            <span className="px-3 py-1 rounded text-[11px] font-bold"
              style={{ background: `${statusColor(current.status)}18`, color: statusColor(current.status), border: `1px solid ${statusColor(current.status)}44` }}>
              {current.status}
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        ) : !current ? (
          <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>Nessun dato disponibile.</p>
        ) : <>
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Usage" value={`${current.usage}%`}
              sub={`Δ ${current.delta >= 0 ? '+' : ''}${current.delta}% ultimo tick`} color={usageColor} />
            <MetricCard label="Velocità" value={`${current.velocity}%/h`}
              sub="istantanea" color={current.velocity > 30 ? 'var(--color-red)' : 'var(--color-muted)'} />
            <MetricCard label="Proiezione" value={`${current.projection}%`}
              sub="a fine sessione" color={current.projection > 100 ? 'var(--color-red)' : 'var(--color-green)'} />
            <MetricCard label="Throttle" value={String(current.throttle)}
              sub={nextReset ? `reset ${nextReset}` : undefined}
              color={current.throttle >= 3 ? 'var(--color-red)' : current.throttle > 0 ? 'var(--color-yellow)' : 'var(--color-green)'} />
          </div>

          {/* Chart */}
          {chartData.length > 1 && (
            <div className="rounded-xl px-4 pt-4 pb-2" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
              <p className="text-[9px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--color-dim)' }}>Storico usage</p>
              <AreaChart data={chartData} height={120} color={usageColor} showLabels={false} />
            </div>
          )}

          {/* Orders */}
          {orders.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <p className="px-4 py-2.5 text-[9px] uppercase tracking-widest font-bold"
                style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-deep)', color: 'var(--color-dim)' }}>
                Storico ordini throttle
              </p>
              <div style={{ background: 'var(--color-panel)' }}>
                {orders.map((o, i) => <div key={i} style={{ animation: `fade-in 0.35s ease ${i * 0.04}s both` }}><OrderRow o={o} /></div>)}
              </div>
            </div>
          )}
        </>}

        {!loading && <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Aggiornamento ogni 30s</p>}
      </div>
    </main>
  )
}
