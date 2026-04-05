'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

type Status = 'connected' | 'configured' | 'disconnected'
type Integration = { id: string; name: string; description: string; status: Status; detail: string | null; last_sync: string | null }

const ICONS: Record<string, string> = {
  telegram: '✈️', github: '🐙', linkedin: '💼', gmail: '📧', vercel: '▲',
}

const STATUS_CFG: Record<Status, { color: string; bg: string; label: string }> = {
  connected:    { color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)',  label: 'Connessa' },
  configured:   { color: 'var(--color-yellow)', bg: 'rgba(255,196,0,0.08)',  label: 'Configurata' },
  disconnected: { color: 'var(--color-dim)',     bg: 'transparent',           label: 'Non configurata' },
}

function IntCard({ i }: { i: Integration }) {
  const { color, bg, label } = STATUS_CFG[i.status]
  return (
    <div className="flex flex-col gap-4 p-5 rounded-xl transition-all"
      style={{ border: `1px solid ${i.status === 'connected' ? color + '33' : 'var(--color-border)'}`, background: 'var(--color-panel)' }}>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{ICONS[i.id] ?? '🔌'}</span>
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--color-white)' }}>{i.name}</p>
            <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{i.description}</p>
          </div>
        </div>
        <span className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold"
          style={{ border: `1px solid ${color}44`, background: bg, color }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block',
            animation: i.status === 'connected' ? 'pulse-dot 2.5s ease-in-out infinite' : 'none' }} />
          {label}
        </span>
      </div>

      {(i.detail || i.last_sync) && (
        <div className="flex flex-col gap-0.5">
          {i.detail    && <p className="text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>{i.detail}</p>}
          {i.last_sync && <p className="text-[9px]"           style={{ color: 'var(--color-dim)'   }}>Ultima modifica: {i.last_sync}</p>}
        </div>
      )}

      <Link href="/settings" className="self-start px-3 py-1.5 rounded text-[10px] font-semibold no-underline transition-all"
        style={{
          border: `1px solid ${i.status === 'connected' ? 'rgba(255,69,96,0.3)' : color + '44'}`,
          color:  i.status === 'connected' ? 'var(--color-red)' : color,
          background: 'transparent',
        }}>
        {i.status === 'connected' ? 'Disconnetti' : 'Configura'} →
      </Link>
    </div>
  )
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [summary, setSummary]           = useState({ connected: 0, configured: 0, disconnected: 0 })
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    fetch('/api/integrations').then(r => r.json()).then(d => {
      setIntegrations(d.integrations ?? [])
      setSummary(d.summary ?? { connected: 0, configured: 0, disconnected: 0 })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen px-6 py-10" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="max-w-4xl flex flex-col gap-6">

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Integrazioni</span>
        </nav>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>Integrazioni</h1>
          </div>
          {!loading && (
            <div className="flex gap-3 text-[10px] font-mono">
              <span style={{ color: 'var(--color-green)'  }}>{summary.connected} connesse</span>
              <span style={{ color: 'var(--color-yellow)' }}>{summary.configured} configurate</span>
              <span style={{ color: 'var(--color-dim)'    }}>{summary.disconnected} assenti</span>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {integrations.map(i => <IntCard key={i.id} i={i} />)}
          </div>
        )}
      </div>
    </main>
  )
}
