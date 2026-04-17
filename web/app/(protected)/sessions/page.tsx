'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from './components/EmptyState'

type SessionState = 'active' | 'paused' | 'ended'
type Session = {
  id: string; label?: string; channelId: string; state: SessionState
  provider?: string; model?: string; createdAtMs: number; updatedAtMs: number
  lastMessageAtMs?: number; messageCount: number
}

const STATE_CFG: Record<SessionState, { label: string; color: string }> = {
  active: { label: 'attiva',    color: 'var(--color-green)'  },
  paused: { label: 'in pausa',  color: 'var(--color-yellow)' },
  ended:  { label: 'terminata', color: 'var(--color-dim)'    },
}
const CHANNEL_ICON: Record<string, string> = { web: '🌐', cli: '💻', telegram: '✈️' }

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDuration(start: number, end: number): string {
  const s = Math.floor((end - start) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function SessionRow({ s, onPatch }: { s: Session; onPatch: (id: string, state: SessionState) => void }) {
  const cfg = STATE_CFG[s.state]
  const end = s.lastMessageAtMs ?? s.updatedAtMs
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors hover:bg-[rgba(255,255,255,0.015)]" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-base flex-shrink-0" aria-hidden="true">{CHANNEL_ICON[s.channelId] ?? '◆'}</span>
      <div className="flex-1 min-w-0">
        <Link href={`/sessions/${s.id}`} className="text-[12px] font-semibold no-underline hover:underline" style={{ color: 'var(--color-bright)' }}>
          {s.label ?? s.id.slice(0, 12) + '…'}
        </Link>
        <p className="text-[9px] font-mono text-[var(--color-dim)] mt-0.5">
          {s.channelId} · {s.provider ?? '—'} · {s.messageCount} msg · {fmtDuration(s.createdAtMs, end)} · {fmtDate(s.createdAtMs)}
        </p>
      </div>
      <span className="badge text-[9px] font-mono" style={{ color: cfg.color, border: `1px solid ${cfg.color}44`, background: `${cfg.color}0d` }}>{cfg.label}</span>
      <div className="flex gap-1 flex-shrink-0">
        {s.state !== 'active' && <button onClick={() => onPatch(s.id, 'active')} aria-label="Riprendi sessione" className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid rgba(0,232,122,0.2)', color: 'var(--color-green)', background: 'transparent' }}>▶</button>}
        {s.state === 'active' && <button onClick={() => onPatch(s.id, 'paused')} aria-label="Pausa sessione" className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid rgba(245,197,24,0.2)', color: 'var(--color-yellow)', background: 'transparent' }}>⏸</button>}
        {s.state !== 'ended'  && <button onClick={() => onPatch(s.id, 'ended')} aria-label="Termina sessione" className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid rgba(255,69,96,0.2)', color: 'var(--color-red)', background: 'transparent' }}>■</button>}
      </div>
    </div>
  )
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | SessionState>('all')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/sessions').catch(() => null)
    if (res?.ok) { const d = await res.json(); setSessions(d.sessions ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const iv = setInterval(fetchData, 10000); return () => clearInterval(iv) }, [fetchData])

  const patchState = useCallback(async (id: string, state: SessionState) => {
    await fetch('/api/sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, state }) }).catch(() => null)
    await fetchData()
  }, [fetchData])

  const visible = filter === 'all' ? sessions : sessions.filter(s => s.state === filter)
  const sorted = [...visible].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  const counts = { active: sessions.filter(s => s.state === 'active').length, paused: sessions.filter(s => s.state === 'paused').length, ended: sessions.filter(s => s.state === 'ended').length }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Sessioni</span>
        </nav>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Sessioni</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{sessions.length} totali · {counts.active} attive · {counts.paused} in pausa</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {(['all', 'active', 'paused', 'ended'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ border: `1px solid ${filter === f ? 'var(--color-green)' : 'var(--color-border)'}`, color: filter === f ? 'var(--color-green)' : 'var(--color-dim)', background: filter === f ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
              {f === 'all' ? `tutte (${sessions.length})` : `${STATE_CFG[f].label} (${counts[f]})`}
            </button>
          ))}
        </div>
      </div>
      {loading && <div className="flex justify-center py-16" role="status" aria-live="polite"><span className="text-[var(--color-dim)] text-[12px]">Caricamento sessioni…</span></div>}
      {!loading && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {sorted.length === 0
            ? <EmptyState icon="💬" title="Nessuna sessione" description="Le conversazioni con gli agenti appariranno qui." size="md" />
            : sorted.map(s => <SessionRow key={s.id} s={s} onPatch={patchState} />)
          }
        </div>
      )}
    </div>
  )
}
