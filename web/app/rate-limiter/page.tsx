'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type RetryConfig = { attempts: number; minDelayMs: number; maxDelayMs: number; jitter: number }
type WindowConfig = { maxRequests: number; windowMs: number }
type ProviderLimit = { id: string; label: string; window: WindowConfig; retry: RetryConfig; backoffSteps: number[] }
type RateLimiterData = { globalWindow: WindowConfig; providers: ProviderLimit[]; defaults: { window: WindowConfig; retry: RetryConfig }; configLoaded: boolean; ts: number }

const PROVIDER_ICONS: Record<string, string> = { claude: '🟠', openai: '🟢', minimax: '🔵' }

function fmt(ms: number) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(0)}m`
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
}

function BackoffBar({ steps, max }: { steps: number[]; max: number }) {
  return (
    <div className="flex items-end gap-1 h-10">
      {steps.map((ms, i) => {
        const pct = Math.min((ms / max) * 100, 100)
        return (
          <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
            <span className="text-[8px] font-mono text-[var(--color-dim)]">{fmt(ms)}</span>
            <div className="w-full rounded-sm" style={{ height: `${Math.max(pct * 0.24, 4)}px`, background: `rgba(0,232,122,${0.3 + i * 0.15})` }} />
            <span className="text-[8px] font-mono text-[var(--color-dim)]">#{i + 1}</span>
          </div>
        )
      })}
    </div>
  )
}

function ProviderCard({ p }: { p: ProviderLimit }) {
  const icon = PROVIDER_ICONS[p.id] ?? '◆'
  const maxStep = Math.max(...p.backoffSteps, 1)
  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-xl">{icon}</span>
        <div>
          <p className="text-[13px] font-bold text-[var(--color-white)]">{p.label}</p>
          <p className="text-[9px] font-mono text-[var(--color-dim)]">{p.id}</p>
        </div>
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Token window */}
        <div>
          <p className="text-[9px] text-[var(--color-dim)] uppercase tracking-widest mb-2">Token Bucket</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-card)' }}>
              <div className="h-full rounded-full" style={{ width: '100%', background: 'rgba(0,232,122,0.5)' }} />
            </div>
            <span className="text-[10px] font-mono text-[var(--color-bright)] flex-shrink-0">{p.window.maxRequests} req / {fmt(p.window.windowMs)}</span>
          </div>
        </div>
        {/* Retry config */}
        <div>
          <p className="text-[9px] text-[var(--color-dim)] uppercase tracking-widest mb-2">Retry Backoff</p>
          <BackoffBar steps={p.backoffSteps} max={maxStep} />
        </div>
        {/* Retry details */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Tentativi',  value: p.retry.attempts },
            { label: 'Jitter',     value: `±${(p.retry.jitter * 100).toFixed(0)}%` },
            { label: 'Min delay',  value: fmt(p.retry.minDelayMs) },
            { label: 'Max delay',  value: fmt(p.retry.maxDelayMs) },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2 rounded border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
              <p className="text-[8px] text-[var(--color-dim)]">{label}</p>
              <p className="text-[11px] font-mono font-semibold text-[var(--color-bright)]">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function RateLimiterPage() {
  const [data, setData] = useState<RateLimiterData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/rate-limiter').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Rate Limiter</span>
        </div>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Rate Limiter</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data ? `${data.providers.length} provider · finestra globale: ${data.globalWindow.maxRequests} req/${fmt(data.globalWindow.windowMs)}` : 'Caricamento…'}
              {data && !data.configLoaded && <span className="ml-2 text-[var(--color-yellow)]">⚠ jht.config.json non trovato</span>}
            </p>
          </div>
          <button onClick={fetchData}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-green)'; e.currentTarget.style.color = 'var(--color-green)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
            ↻ aggiorna
          </button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento configurazione…</span></div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.providers.map(p => <ProviderCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}
