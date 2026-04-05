'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Alert = { id: string; name: string; condition: string; conditionType: string; channel: string; frequency: string; enabled: boolean; lastTriggered: number | null; triggerCount: number }

const CH_CLR: Record<string, { color: string; label: string }> = {
  email: { color: '#61affe', label: 'email' }, telegram: { color: '#49cc90', label: 'telegram' }, web: { color: '#fca130', label: 'web' },
}
const FREQ_LABEL: Record<string, string> = { realtime: 'tempo reale', daily: 'giornaliero', weekly: 'settimanale' }
const TYPE_LABEL: Record<string, string> = { 'job-match': 'Job Match', 'interview-reminder': 'Reminder', deadline: 'Deadline', 'status-change': 'Stato' }

function timeAgo(ts: number | null): string {
  if (!ts) return 'mai';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function AlertRow({ a, expanded, onToggle, onSwitch }: { a: Alert; expanded: boolean; onToggle: () => void; onSwitch: (id: string, en: boolean) => void }) {
  const ch = CH_CLR[a.channel] ?? { color: 'var(--color-dim)', label: a.channel };
  return (
    <div className="border-b border-[var(--color-border)]">
      <div role="button" tabIndex={0} aria-expanded={expanded} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.enabled ? 'var(--color-green)' : 'var(--color-dim)' }} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{a.name}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{TYPE_LABEL[a.conditionType] ?? a.conditionType} · {FREQ_LABEL[a.frequency] ?? a.frequency}</p>
        </div>
        <span className="badge text-[8px] px-2 py-0.5 rounded" style={{ color: ch.color, border: `1px solid ${ch.color}40` }}>{ch.label}</span>
        <span className="text-[9px] font-mono text-[var(--color-dim)] w-10 text-right">{a.triggerCount}x</span>
        <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(a.lastTriggered)}</span>
        <button onClick={e => { e.stopPropagation(); onSwitch(a.id, !a.enabled); }} className="text-[9px] font-bold cursor-pointer w-8"
          style={{ color: a.enabled ? 'var(--color-green)' : 'var(--color-dim)' }}>{a.enabled ? 'ON' : 'OFF'}</button>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-10">
          <p className="text-[9px] text-[var(--color-dim)] mb-1 font-semibold">Condizione:</p>
          <pre className="text-[9px] font-mono text-[var(--color-muted)] p-2 rounded" style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>{a.condition}</pre>
        </div>
      )}
    </div>
  )
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState(0)
  const [channelFilter, setChannelFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/alerts${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setAlerts(data.alerts ?? []); setTotal(data.total ?? 0); setEnabled(data.enabled ?? 0);
  }, [channelFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const toggle = async (id: string, en: boolean) => {
    await fetch('/api/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled: en }) }).catch(() => null);
    fetchData();
  }

  const CHANNELS = [{ key: 'all', label: 'tutti' }, { key: 'email', label: 'email' }, { key: 'telegram', label: 'telegram' }, { key: 'web', label: 'web' }];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Alert</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Alert</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{enabled} attivi · {total} totali</p>
      </div>

      <div className="flex gap-1 mb-4">
        {CHANNELS.map(c => (
          <button key={c.key} onClick={() => setChannelFilter(c.key)}
            className="px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: channelFilter === c.key ? 'var(--color-row)' : 'transparent', color: channelFilter === c.key ? (CH_CLR[c.key]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${channelFilter === c.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {alerts.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun alert trovato.</p></div>
          : alerts.map(a => <AlertRow key={a.id} a={a} expanded={expandedId === a.id} onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)} onSwitch={toggle} />)}
      </div>
    </div>
  )
}
