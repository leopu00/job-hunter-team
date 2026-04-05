'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ErrorStatus = 'open' | 'resolved' | 'ignored'
type TrackedError = { id: string; message: string; stack: string; type: string; source: string; status: ErrorStatus; count: number; firstSeen: number; lastSeen: number }

const STATUS_CFG: Record<ErrorStatus, { color: string; bg: string; label: string }> = {
  open:     { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',  label: 'aperto' },
  resolved: { color: 'var(--color-green)',  bg: 'rgba(0,200,83,0.08)',   label: 'risolto' },
  ignored:  { color: 'var(--color-dim)',    bg: 'transparent',           label: 'ignorato' },
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function ErrorRow({ err, onStatus, expanded, onExpand }: { err: TrackedError; onStatus: (id: string, s: ErrorStatus) => void; expanded: boolean; onExpand: () => void }) {
  const cfg = STATUS_CFG[err.status];
  return (
    <div className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onExpand}>
        <span className="w-8 text-[12px] font-bold font-mono text-[var(--color-red)] text-center">{err.count}x</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] truncate">{err.message}</p>
          <p className="text-[9px] text-[var(--color-dim)] font-mono">{err.source} · {err.type}</p>
        </div>
        <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">{timeAgo(err.lastSeen)}</span>
        <span className="badge text-[9px] flex-shrink-0" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
        <div className="flex gap-1 flex-shrink-0">
          {err.status !== 'resolved' && <button onClick={e => { e.stopPropagation(); onStatus(err.id, 'resolved'); }} className="text-[9px] font-bold cursor-pointer" style={{ color: 'var(--color-green)' }}>risolvi</button>}
          {err.status !== 'ignored' && <button onClick={e => { e.stopPropagation(); onStatus(err.id, 'ignored'); }} className="text-[9px] font-bold cursor-pointer" style={{ color: 'var(--color-dim)' }}>ignora</button>}
          {err.status !== 'open' && <button onClick={e => { e.stopPropagation(); onStatus(err.id, 'open'); }} className="text-[9px] font-bold cursor-pointer" style={{ color: 'var(--color-red)' }}>riapri</button>}
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-3">
          <pre className="text-[9px] font-mono text-[var(--color-muted)] p-3 rounded overflow-x-auto" style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>{err.stack}</pre>
          <p className="text-[9px] text-[var(--color-dim)] mt-1">Prima: {timeAgo(err.firstSeen)} · Ultima: {timeAgo(err.lastSeen)} · {err.count} occorrenze</p>
        </div>
      )}
    </div>
  )
}

export default function ErrorsPage() {
  const [errors, setErrors] = useState<TrackedError[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchErrors = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/errors${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setErrors(data.errors ?? []); setTypes(data.types ?? []); setOpenCount(data.openCount ?? 0);
  }, [filter, typeFilter])

  useEffect(() => { fetchErrors() }, [fetchErrors])

  const updateStatus = async (id: string, status: ErrorStatus) => {
    await fetch('/api/errors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }).catch(() => null);
    fetchErrors();
  }

  const FILTERS: Array<{ key: string; label: string }> = [
    { key: 'all', label: 'tutti' }, { key: 'open', label: 'aperti' }, { key: 'resolved', label: 'risolti' }, { key: 'ignored', label: 'ignorati' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Errori</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Errori</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{openCount} aperti · {errors.length} totali</p>
      </div>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ background: filter === f.key ? 'var(--color-row)' : 'transparent', color: filter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {f.label}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          aria-label="Filtra per tipo errore" className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <option value="all">Tutti i tipi</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {errors.length === 0
          ? <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun errore trovato.</p></div>
          : errors.map(e => <ErrorRow key={e.id} err={e} onStatus={updateStatus} expanded={expandedId === e.id} onExpand={() => setExpandedId(expandedId === e.id ? null : e.id)} />)
        }
      </div>
    </div>
  )
}
