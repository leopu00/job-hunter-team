'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ChannelId = 'web' | 'cli' | 'telegram' | 'email' | 'slack' | 'webhook'
type Caps = { markdown: boolean; streaming: boolean; attachments: boolean; push: boolean }
type Stats = { messagesSent: number; messagesReceived: number; lastActivityAt: number | null; errors: number }
type ChannelInfo = { id: ChannelId; name: string; description: string; connected: boolean; enabled: boolean; capabilities: Caps; stats: Stats }

const CH_ICON: Record<ChannelId, string> = { web: 'W', cli: 'C', telegram: 'T', email: 'E', slack: 'S', webhook: 'H' }

function CapBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{ color: active ? 'var(--color-green)' : 'var(--color-dim)', background: active ? 'rgba(0,232,122,0.08)' : 'transparent', border: `1px solid ${active ? 'rgba(0,232,122,0.2)' : 'var(--color-border)'}` }}>
      {label}
    </span>
  )
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[14px] font-bold text-[var(--color-bright)]">{value}</span>
      <span className="text-[9px] text-[var(--color-dim)] uppercase tracking-widest">{label}</span>
    </div>
  )
}

function ChannelCard({ ch, onToggle }: { ch: ChannelInfo; onToggle: (id: ChannelId, enabled: boolean) => void }) {
  const lastActivity = ch.stats.lastActivityAt
    ? new Date(ch.stats.lastActivityAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'mai'

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">{CH_ICON[ch.id]}</span>
          <div>
            <h3 className="text-[14px] font-bold text-[var(--color-bright)]">{ch.name}</h3>
            <p className="text-[10px] text-[var(--color-muted)]">{ch.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold"
            style={{ color: ch.connected ? 'var(--color-green)' : 'var(--color-red)', background: ch.connected ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,96,0.08)', border: `1px solid ${ch.connected ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,96,0.3)'}` }}>
            {ch.connected ? 'connesso' : 'disconnesso'}
          </span>
          <button onClick={() => onToggle(ch.id, !ch.enabled)}
            className="px-2 py-1 rounded text-[9px] font-bold cursor-pointer transition-colors"
            style={{ color: ch.enabled ? 'var(--color-green)' : 'var(--color-dim)', background: ch.enabled ? 'rgba(0,232,122,0.08)' : 'var(--color-row)', border: `1px solid ${ch.enabled ? 'rgba(0,232,122,0.3)' : 'var(--color-border)'}` }}>
            {ch.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <CapBadge label="markdown" active={ch.capabilities.markdown} />
        <CapBadge label="streaming" active={ch.capabilities.streaming} />
        <CapBadge label="allegati" active={ch.capabilities.attachments} />
        <CapBadge label="push" active={ch.capabilities.push} />
      </div>

      <div className="flex justify-between pt-3 border-t border-[var(--color-border)]">
        <StatItem label="inviati" value={ch.stats.messagesSent} />
        <StatItem label="ricevuti" value={ch.stats.messagesReceived} />
        <StatItem label="errori" value={ch.stats.errors} />
        <StatItem label="ultima att." value={lastActivity} />
      </div>
    </div>
  )
}

type FilterStatus = 'all' | 'connected' | 'disconnected'

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [connectedCount, setConnectedCount] = useState(0)
  const [filter, setFilter] = useState<FilterStatus>('all')

  const fetchChannels = useCallback(async () => {
    const q = filter !== 'all' ? `?status=${filter}` : ''
    const res = await fetch(`/api/channels${q}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setChannels(data.channels ?? [])
    setConnectedCount(data.connectedCount ?? 0)
  }, [filter])

  useEffect(() => { fetchChannels() }, [fetchChannels])
  useEffect(() => { const id = setInterval(fetchChannels, 5000); return () => clearInterval(id) }, [fetchChannels])

  const toggleChannel = async (id: ChannelId, enabled: boolean) => {
    await fetch('/api/channels', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) }).catch(() => null)
    fetchChannels()
  }

  const FILTERS: Array<{ key: FilterStatus; label: string }> = [
    { key: 'all', label: 'tutti' }, { key: 'connected', label: 'connessi' }, { key: 'disconnected', label: 'disconnessi' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Canali</span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Canali</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{connectedCount} connessi · {channels.filter(c => c.enabled).length} attivi · {channels.length} totali</p>
      </div>

      <div className="flex gap-1 mb-6">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: filter === f.key ? 'var(--color-row)' : 'transparent', color: filter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {channels.length === 0
          ? <div className="col-span-full flex flex-col items-center py-16"><p className="text-[var(--color-dim)] text-[12px]">Nessun canale trovato.</p></div>
          : channels.map(ch => <ChannelCard key={ch.id} ch={ch} onToggle={toggleChannel} />)
        }
      </div>
    </div>
  )
}
