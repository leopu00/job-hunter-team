'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ChannelId = 'web' | 'telegram' | 'cli'
type Channel = { id: ChannelId; connected: boolean; label: string }
type MiddlewareEntry = { name: string; phase: 'pre' | 'post'; priority: number; description: string }
type GatewayConfig = { port: number; channels: ChannelId[]; requestTimeoutMs: number; maxQueueSize: number }

type GatewayData = {
  reachable: boolean
  url: string
  latencyMs: number
  channels: Channel[]
  config: GatewayConfig
  middleware: MiddlewareEntry[]
  remoteStatus: unknown
  ts: number
}

const CHANNEL_ICONS: Record<ChannelId, string> = { web: '🌐', telegram: '✈', cli: '⌨' }

function StatusDot({ ok, pulse }: { ok: boolean; pulse?: boolean }) {
  return (
    <span style={{ color: ok ? 'var(--color-green)' : 'var(--color-dim)', animation: ok && pulse ? 'pulse-dot 2.5s ease-in-out infinite' : undefined }}>●</span>
  )
}

function ChannelCard({ ch }: { ch: Channel }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border text-[11px]"
      style={{ borderColor: ch.connected ? 'rgba(0,232,122,0.25)' : 'var(--color-border)', background: ch.connected ? 'rgba(0,232,122,0.04)' : 'var(--color-panel)' }}>
      <span className="text-base">{CHANNEL_ICONS[ch.id]}</span>
      <div className="flex-1">
        <p className="font-semibold" style={{ color: ch.connected ? 'var(--color-bright)' : 'var(--color-dim)' }}>{ch.label}</p>
        <p className="font-mono text-[9px] text-[var(--color-dim)]">{ch.id}</p>
      </div>
      <StatusDot ok={ch.connected} pulse />
      <span className="badge text-[9px]" style={{ color: ch.connected ? 'var(--color-green)' : 'var(--color-dim)', border: `1px solid ${ch.connected ? 'rgba(0,232,122,0.25)' : 'var(--color-border)'}`, background: 'transparent' }}>
        {ch.connected ? 'connesso' : 'offline'}
      </span>
    </div>
  )
}

function MiddlewareRow({ mw, last }: { mw: MiddlewareEntry; last: boolean }) {
  const phaseColor = mw.phase === 'pre' ? 'var(--color-blue)' : 'var(--color-orange)'
  return (
    <div className={`flex items-center gap-4 px-5 py-3 ${last ? '' : 'border-b border-[var(--color-border)]'}`}>
      <span className="text-[9px] font-mono px-2 py-0.5 rounded border" style={{ color: phaseColor, borderColor: `${phaseColor}44`, background: `${phaseColor}0d`, minWidth: 36, textAlign: 'center' }}>
        {mw.phase}
      </span>
      <span className="text-[10px] font-mono text-[var(--color-bright)] w-28 flex-shrink-0">{mw.name}</span>
      <span className="flex-1 text-[10px] text-[var(--color-dim)]">{mw.description}</span>
      <span className="text-[9px] font-mono text-[var(--color-dim)]">p{mw.priority}</span>
    </div>
  )
}

export default function GatewayPage() {
  const [data, setData] = useState<GatewayData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/gateway').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [fetchData])

  const pre = data?.middleware.filter(m => m.phase === 'pre').sort((a, b) => a.priority - b.priority) ?? []
  const post = data?.middleware.filter(m => m.phase === 'post').sort((a, b) => a.priority - b.priority) ?? []
  const pipeline = [...pre, ...post]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Gateway</span>
        </div>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] flex items-center gap-3">
              Gateway
              {data && (
                <span className="text-sm font-normal px-2.5 py-0.5 rounded-full border"
                  style={{ color: data.reachable ? 'var(--color-green)' : 'var(--color-red)', borderColor: data.reachable ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,96,0.3)', background: data.reachable ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,96,0.08)' }}>
                  {data.reachable ? '● raggiungibile' : '✗ non raggiungibile'}
                </span>
              )}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1 font-mono">
              {data ? `${data.url} · ${data.latencyMs}ms` : 'Caricamento…'}
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

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Connessione gateway…</span></div>}

      {data && (<>
        {/* Canali */}
        <div className="mb-6">
          <div className="section-label">Canali — {data.channels.filter(c => c.connected).length}/{data.channels.length} connessi</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.channels.map(ch => <ChannelCard key={ch.id} ch={ch} />)}
          </div>
        </div>

        {/* Pipeline middleware */}
        <div className="mb-6">
          <div className="section-label">Pipeline middleware</div>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {pipeline.map((mw, i) => <MiddlewareRow key={`${mw.phase}-${mw.name}-${i}`} mw={mw} last={i === pipeline.length - 1} />)}
          </div>
        </div>

        {/* Config */}
        <div className="mb-6">
          <div className="section-label">Configurazione</div>
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Porta', value: data.config.port },
              { label: 'Timeout richiesta', value: `${(data.config.requestTimeoutMs / 1000).toFixed(0)}s` },
              { label: 'Max queue', value: data.config.maxQueueSize },
              { label: 'Canali abilitati', value: data.config.channels.join(', ') },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[9px] text-[var(--color-dim)] mb-1">{label}</p>
                <p className="text-[12px] font-mono font-semibold text-[var(--color-bright)]">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Remote status raw */}
        {data.remoteStatus && (
          <div className="mb-6">
            <div className="section-label">Status remoto</div>
            <pre className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] px-5 py-4 text-[10px] font-mono text-[var(--color-muted)] overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(data.remoteStatus, null, 2)}
            </pre>
          </div>
        )}
      </>)}
    </div>
  )
}
