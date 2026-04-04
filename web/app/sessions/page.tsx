'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type SessionEntry = {
  id: string; label?: string; channelId: string; state: 'active' | 'paused' | 'ended'
  provider?: string; model?: string; createdAtMs: number; updatedAtMs: number
  lastMessageAtMs?: number; messageCount: number
}

const STATE_COLORS: Record<string, string> = { active: 'var(--color-green)', paused: 'var(--color-yellow)', ended: 'var(--color-dim)' }
const STATE_LABELS: Record<string, string> = { active: 'Attiva', paused: 'In pausa', ended: 'Terminata' }

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(start: number, end: number): string {
  const s = Math.floor((end - start) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function SessionRow({ s }: { s: SessionEntry }) {
  const color = STATE_COLORS[s.state] ?? 'var(--color-dim)'
  const end = s.lastMessageAtMs ?? s.updatedAtMs
  return (
    <Link href={`/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors no-underline">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--color-bright)] truncate">{s.label ?? s.id.slice(0, 8)}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: `${color}22`, color }}>{STATE_LABELS[s.state]}</span>
        </div>
        <div className="flex gap-3 mt-0.5 text-[9px] text-[var(--color-dim)]">
          <span>{s.channelId}</span>
          {s.model && <span>{s.model}</span>}
          <span>{s.messageCount} msg</span>
          <span>{fmtDuration(s.createdAtMs, end)}</span>
        </div>
      </div>
      <span className="text-[10px] text-[var(--color-dim)] shrink-0">{fmtDate(s.createdAtMs)}</span>
    </Link>
  )
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'ended'>('all')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/sessions').catch(() => null)
    if (res?.ok) { const d = await res.json(); setSessions(d.sessions ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const iv = setInterval(fetchData, 10000); return () => clearInterval(iv) }, [fetchData])

  const filtered = filter === 'all' ? sessions : sessions.filter(s => s.state === filter)
  const sorted = [...filtered].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  const counts = { active: sessions.filter(s => s.state === 'active').length, paused: sessions.filter(s => s.state === 'paused').length, ended: sessions.filter(s => s.state === 'ended').length }

  const FILTERS = [
    { v: 'all' as const, l: 'Tutte', c: sessions.length },
    { v: 'active' as const, l: 'Attive', c: counts.active },
    { v: 'paused' as const, l: 'In pausa', c: counts.paused },
    { v: 'ended' as const, l: 'Terminate', c: counts.ended },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Sessioni</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Sessioni</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{sessions.length} sessioni — {counts.active} attive</p>
          </div>
          <div className="flex gap-1">
            {FILTERS.map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
                style={{ background: filter === f.v ? 'var(--color-row)' : 'transparent', color: filter === f.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {f.l} ({f.c})
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Caricamento...</p>
      ) : sorted.length === 0 ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">{sessions.length === 0 ? 'Nessuna sessione.' : 'Nessuna sessione per il filtro selezionato.'}</p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Sessioni</p>
            <p className="text-[10px] text-[var(--color-dim)]">{sorted.length} mostrate</p>
          </div>
          {sorted.map(s => <SessionRow key={s.id} s={s} />)}
        </div>
      )}
    </div>
  )
}
