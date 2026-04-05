'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type BreakerInfo = {
  id: string; label: string; state: 'closed' | 'open' | 'half-open'
  failures: number; successes: number
  failureThreshold: number; resetTimeoutMs: number; halfOpenSuccesses: number
  lastFailureAt?: number; lastSuccessAt?: number; openedAt?: number
  totalFailures: number; totalSuccesses: number; totalOpened: number
}
type Summary = { total: number; closed: number; open: number; halfOpen: number; totalFailures: number }
type Data = { breakers: BreakerInfo[]; summary: Summary; updatedAt: number }

const STATE_COLORS: Record<string, string> = {
  closed: 'var(--color-green)', open: 'var(--color-red)', 'half-open': 'var(--color-yellow)',
}
const STATE_LABELS: Record<string, string> = {
  closed: 'Chiuso', open: 'Aperto', 'half-open': 'Semi-aperto',
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
    </div>
  )
}

function StateBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? 'var(--color-dim)'
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: state === 'open' ? `0 0 6px ${color}` : 'none' }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{STATE_LABELS[state] ?? state}</span>
    </span>
  )
}

function ago(ts?: number): string {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s fa`
  if (s < 3600) return `${Math.floor(s / 60)}m fa`
  return `${Math.floor(s / 3600)}h fa`
}

function BreakerCard({ b, onReset, resetting }: { b: BreakerInfo; onReset: (id: string) => void; resetting: string | null }) {
  const failPct = b.failureThreshold > 0 ? Math.min(100, (b.failures / b.failureThreshold) * 100) : 0
  return (
    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--color-bright)]">{b.label || b.id}</p>
          <p className="text-[9px] text-[var(--color-dim)] font-mono mt-0.5">{b.id}</p>
        </div>
        <StateBadge state={b.state} />
      </div>
      <div className="mb-3">
        <div className="flex justify-between text-[9px] text-[var(--color-dim)] mb-1">
          <span>Fallimenti: {b.failures}/{b.failureThreshold}</span>
          <span>{Math.round(failPct)}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-[var(--color-border)]">
          <div className="h-full rounded-full transition-all" style={{ width: `${failPct}%`, background: failPct >= 80 ? 'var(--color-red)' : failPct >= 50 ? 'var(--color-yellow)' : 'var(--color-green)' }} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] text-[var(--color-dim)] mb-3">
        <div>Totale fail: <span className="text-[var(--color-muted)]">{b.totalFailures}</span></div>
        <div>Totale ok: <span className="text-[var(--color-muted)]">{b.totalSuccesses}</span></div>
        <div>Aperture: <span className="text-[var(--color-muted)]">{b.totalOpened}</span></div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[9px] text-[var(--color-dim)]">
          {b.lastFailureAt ? `Ultimo fail: ${ago(b.lastFailureAt)}` : 'Nessun fallimento'}
          {b.state === 'open' && b.openedAt && ` · Reset tra ${Math.max(0, Math.ceil((b.resetTimeoutMs - (Date.now() - b.openedAt)) / 1000))}s`}
        </div>
        {b.state !== 'closed' && (
          <button onClick={() => onReset(b.id)} disabled={resetting === b.id}
            className="text-[10px] px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}>
            {resetting === b.id ? 'Reset...' : 'Reset'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function RetryPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/retry').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const iv = setInterval(fetchData, 5000); return () => clearInterval(iv) }, [fetchData])

  async function handleReset(id: string) {
    setResetting(id)
    await fetch('/api/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null)
    await fetchData()
    setResetting(null)
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Circuit Breaker</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Circuit Breaker</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Stato circuit breaker — open/closed/half-open, fallimenti, reset</p>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse" role="status" aria-live="polite">Caricamento...</p>
      ) : !data || data.breakers.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[var(--color-dim)] text-[12px]">Nessun circuit breaker registrato.</p>
          <p className="text-[var(--color-dim)] text-[10px] mt-1">I circuit breaker appariranno qui quando i servizi esterni vengono monitorati.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Totale" value={String(data.summary.total)} color="var(--color-bright)" />
            <StatCard label="Chiusi" value={String(data.summary.closed)} color="var(--color-green)" />
            <StatCard label="Aperti" value={String(data.summary.open)} color="var(--color-red)" />
            <StatCard label="Semi-aperti" value={String(data.summary.halfOpen)} color="var(--color-yellow)" />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {data.breakers.map((b, i) => <div key={b.id} style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}><BreakerCard b={b} onReset={handleReset} resetting={resetting} /></div>)}
          </div>
        </>
      )}
    </div>
  )
}
