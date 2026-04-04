'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type AgentMetrics = {
  agentId: string
  tasks: { total: number; succeeded: number; failed: number; running: number; avgDurationMs: number }
  api: { calls: number; tokens: number; costUsd: number; errors: number; avgLatencyMs: number }
  successRate: number; score: number
}
type MetricsData = { agents: AgentMetrics[]; totals: { tasks: number; apiCalls: number; tokens: number; costUsd: number; errors: number }; days: number; activeCount: number }

const COLORS = ['var(--color-green)', 'var(--color-blue)', 'var(--color-yellow)', 'var(--color-red)', '#a78bfa', '#f472b6', '#fb923c', '#22d3ee']

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function BarChart({ agents, getValue, label, formatVal }: { agents: AgentMetrics[]; getValue: (a: AgentMetrics) => number; label: string; formatVal?: (v: number) => string }) {
  const max = Math.max(...agents.map(getValue), 1)
  const fmt = formatVal ?? ((v: number) => String(v))
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">{label}</p>
      <div className="space-y-2">
        {agents.map((a, i) => {
          const val = getValue(a)
          const pct = (val / max) * 100
          return (
            <div key={a.agentId} className="flex items-center gap-2">
              <span className="text-[9px] text-[var(--color-muted)] w-16 truncate font-mono">{a.agentId}</span>
              <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: 'var(--color-row)' }}>
                <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length], opacity: 0.8 }} />
              </div>
              <span className="text-[9px] text-[var(--color-muted)] w-14 text-right font-mono">{fmt(val)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreRing({ score, agentId, color }: { score: number; agentId: string; color: string }) {
  const r = 18; const c = 2 * Math.PI * r; const offset = c - (score / 100) * c
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-border)" strokeWidth="3" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 24 24)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="24" y="26" textAnchor="middle" fill={color} fontSize="11" fontWeight="bold">{score}</text>
      </svg>
      <span className="text-[8px] text-[var(--color-dim)] font-mono">{agentId}</span>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-center">
      <p className="text-[18px] font-bold text-[var(--color-bright)]">{value}</p>
      <p className="text-[9px] text-[var(--color-dim)] mt-0.5">{label}</p>
    </div>
  )
}

export default function AgentMetricsPage() {
  const [data, setData] = useState<MetricsData | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/agents/metrics?days=${days}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [days])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])

  const active = data?.agents.filter(a => a.tasks.total > 0 || a.api.calls > 0) ?? []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link href="/agents" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Agenti</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Metriche</span>
        </div>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Metriche Agenti</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{data?.activeCount ?? 0} agenti attivi · ultimi {days} giorni</p>
          </div>
          <div className="flex gap-1">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
                style={{ border: `1px solid ${days === d ? 'var(--color-green)' : 'var(--color-border)'}`, color: days === d ? 'var(--color-green)' : 'var(--color-dim)', background: days === d ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                {d}g
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Caricamento…</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Nessun dato disponibile.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Task totali" value={String(data.totals.tasks)} />
            <StatCard label="Chiamate API" value={String(data.totals.apiCalls)} />
            <StatCard label="Token" value={data.totals.tokens > 1000 ? `${(data.totals.tokens / 1000).toFixed(1)}k` : String(data.totals.tokens)} />
            <StatCard label="Costo" value={`$${data.totals.costUsd.toFixed(2)}`} />
            <StatCard label="Errori" value={String(data.totals.errors)} />
          </div>

          {active.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-4">Score complessivo</p>
              <div className="flex flex-wrap justify-center gap-4">
                {active.map((a, i) => <ScoreRing key={a.agentId} score={a.score} agentId={a.agentId} color={COLORS[i % COLORS.length]} />)}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <BarChart agents={active} getValue={a => a.tasks.total} label="Task completati" />
            <BarChart agents={active} getValue={a => a.tasks.avgDurationMs} label="Durata media task" formatVal={fmtDuration} />
            <BarChart agents={active} getValue={a => a.api.avgLatencyMs} label="Latenza media API (ms)" formatVal={v => `${v}ms`} />
            <BarChart agents={active} getValue={a => a.api.tokens} label="Token consumati" formatVal={v => v > 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          </div>
        </div>
      )}
    </div>
  )
}
