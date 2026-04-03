'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type LatencyStats = { count: number; avgMs: number; minMs: number; maxMs: number; p95Ms: number }
type ProviderStat = { provider: string; calls: number; tokens: number; costUsd: number; errors: number; latency: LatencyStats }
type ModelStat = { provider: string; model: string; calls: number; tokens: number; costUsd: number; latency: LatencyStats }
type DailyStat = { date: string; calls: number; tokens: number; costUsd: number; errors: number }
type Summary = {
  totalCalls: number; totalTokens: number; totalCostUsd: number; totalErrors: number
  latency: LatencyStats; byProvider: ProviderStat[]; byModel: ModelStat[]; daily: DailyStat[]
  days: number; updatedAt: number
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(Math.round(n))
}
function usd(n: number): string { return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}` }

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function BarChart({ data, maxVal }: { data: DailyStat[]; maxVal: number }) {
  if (data.length === 0) return <p className="text-[var(--color-dim)] text-[11px] text-center py-8">Nessun dato</p>
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map(d => {
        const h = maxVal > 0 ? Math.max(2, (d.calls / maxVal) * 100) : 2
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.calls} chiamate, ${fmt(d.tokens)} token, ${usd(d.costUsd)}`}>
            <div className="w-full rounded-t" style={{ height: `${h}%`, background: d.errors > 0 ? 'var(--color-red)' : 'var(--color-green)', opacity: 0.8, minHeight: 2 }} />
            {data.length <= 14 && <span className="text-[8px] text-[var(--color-dim)] whitespace-nowrap">{d.date.slice(5)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function ProviderRow({ s }: { s: ProviderStat }) {
  const errRate = s.calls > 0 ? ((s.errors / s.calls) * 100).toFixed(1) : '0'
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors text-[11px]">
      <span className="font-semibold text-[var(--color-bright)] w-20">{s.provider}</span>
      <span className="text-[var(--color-muted)] w-16 text-right">{fmt(s.calls)}</span>
      <span className="text-[var(--color-muted)] w-20 text-right">{fmt(s.tokens)}</span>
      <span className="text-[var(--color-green)] w-16 text-right">{usd(s.costUsd)}</span>
      <span className="text-[var(--color-muted)] w-16 text-right">{s.latency.avgMs}ms</span>
      <span className="w-16 text-right" style={{ color: s.errors > 0 ? 'var(--color-red)' : 'var(--color-dim)' }}>{errRate}%</span>
    </div>
  )
}

function ModelRow({ s }: { s: ModelStat }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors text-[11px]">
      <span className="text-[var(--color-dim)] w-20">{s.provider}</span>
      <span className="font-semibold text-[var(--color-bright)] flex-1 truncate">{s.model}</span>
      <span className="text-[var(--color-muted)] w-16 text-right">{fmt(s.calls)}</span>
      <span className="text-[var(--color-green)] w-16 text-right">{usd(s.costUsd)}</span>
      <span className="text-[var(--color-muted)] w-16 text-right">{s.latency.p95Ms}ms</span>
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/analytics?days=${days}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [days])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const id = setInterval(fetchData, 15000); return () => clearInterval(id) }, [fetchData])

  const PERIODS = [{ v: 1, l: '24h' }, { v: 7, l: '7g' }, { v: 30, l: '30g' }]
  const maxCalls = data ? Math.max(...data.daily.map(d => d.calls), 1) : 1

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
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Metriche API — chiamate, token, latenza, costo</p>
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

      {loading && !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Caricamento...</p>
      ) : !data || data.totalCalls === 0 ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Nessun dato per il periodo selezionato.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Chiamate" value={fmt(data.totalCalls)} color="var(--color-bright)" />
            <StatCard label="Token" value={fmt(data.totalTokens)} color="var(--color-blue)" />
            <StatCard label="Costo" value={usd(data.totalCostUsd)} color="var(--color-green)" />
            <StatCard label="Latenza p95" value={`${data.latency.p95Ms}ms`} sub={`avg ${data.latency.avgMs}ms`} color="var(--color-yellow)" />
          </div>

          <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Chiamate giornaliere</p>
            <BarChart data={data.daily} maxVal={maxCalls} />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] px-4 py-3 border-b border-[var(--color-border)]">Per provider</p>
              {data.byProvider.map(s => <ProviderRow key={s.provider} s={s} />)}
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] px-4 py-3 border-b border-[var(--color-border)]">Per modello</p>
              {data.byModel.map(s => <ModelRow key={`${s.provider}:${s.model}`} s={s} />)}
            </div>
          </div>

          {data.totalErrors > 0 && (
            <div className="p-3 rounded-lg border border-[rgba(255,69,96,0.3)] bg-[rgba(255,69,96,0.05)]">
              <p className="text-[11px] text-[var(--color-red)]">{data.totalErrors} errori nel periodo ({((data.totalErrors / data.totalCalls) * 100).toFixed(1)}%)</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
