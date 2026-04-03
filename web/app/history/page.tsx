'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useMemo } from 'react'

type SessionState = 'active' | 'paused' | 'ended'
type Session = {
  id: string
  label?: string
  channelId: string
  state: SessionState
  provider?: string
  model?: string
  userId?: string
  createdAtMs: number
  updatedAtMs: number
  lastMessageAtMs?: number
  messageCount: number
}

const STATE_CFG: Record<SessionState, { label: string; color: string; border: string }> = {
  active: { label: 'attiva',   color: 'var(--color-green)',  border: 'rgba(0,232,122,0.3)' },
  paused: { label: 'in pausa', color: 'var(--color-yellow)', border: 'rgba(245,197,24,0.3)' },
  ended:  { label: 'terminata',color: 'var(--color-dim)',    border: 'var(--color-border)' },
}

const CHANNEL_ICON: Record<string, string> = {
  web: '🌐', cli: '💻', telegram: '✈️',
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - ms) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'ieri'
  if (diffDays < 7) return `${diffDays}g fa`
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function SessionCard({ session, onOpen, onEnd }: {
  session: Session
  onOpen: (id: string) => void
  onEnd: (id: string) => void
}) {
  const cfg = STATE_CFG[session.state]
  const icon = CHANNEL_ICON[session.channelId] ?? '💬'
  const title = session.label ?? `Sessione ${session.id.slice(0, 8)}`
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors cursor-pointer group"
      onClick={() => onOpen(session.id)}
    >
      <div className="text-xl w-8 text-center flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[12px] font-semibold text-[var(--color-bright)] group-hover:text-[var(--color-white)] transition-colors truncate max-w-[200px]">
            {title}
          </span>
          <span className="badge text-[9px]" style={{ color: cfg.color, border: `1px solid ${cfg.border}`, background: 'transparent' }}>
            {cfg.label}
          </span>
          {session.model && (
            <span className="text-[9px] font-mono text-[var(--color-dim)]">{session.model}</span>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-dim)]">
          {session.messageCount} messaggi · {session.channelId}
          {session.userId && ` · ${session.userId}`}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[10px] text-[var(--color-dim)]">
          {formatDate(session.lastMessageAtMs ?? session.updatedAtMs)}
        </span>
        {session.state !== 'ended' && (
          <button
            onClick={e => { e.stopPropagation(); onEnd(session.id) }}
            className="text-[9px] font-semibold tracking-wide opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            style={{ color: 'var(--color-dim)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}
          >
            chiudi
          </button>
        )}
      </div>
    </div>
  )
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | SessionState>('all')
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions').catch(() => null)
    if (!res?.ok) { setLoading(false); return }
    const data = await res.json()
    setSessions((data.sessions ?? []).sort((a: Session, b: Session) =>
      (b.lastMessageAtMs ?? b.updatedAtMs) - (a.lastMessageAtMs ?? a.updatedAtMs)
    ))
    setLoading(false)
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  const endSession = async (id: string) => {
    await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' }).catch(() => null)
    fetchSessions()
  }

  const openSession = (id: string) => {
    window.location.href = `/assistant?session=${id}`
  }

  const visible = useMemo(() => {
    return sessions.filter(s => {
      if (filter !== 'all' && s.state !== filter) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (s.label ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.channelId.toLowerCase().includes(q)
    })
  }, [sessions, filter, search])

  const FILTERS: Array<{ key: typeof filter; label: string }> = [
    { key: 'all', label: 'tutte' },
    { key: 'active', label: 'attive' },
    { key: 'paused', label: 'in pausa' },
    { key: 'ended', label: 'terminate' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Cronologia</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Cronologia</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">{sessions.length} conversazioni totali</p>
        </div>
      </div>

      {/* Ricerca + filtri */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca per titolo, ID, canale…"
          className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }}
        />
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ background: filter === f.key ? 'var(--color-row)' : 'transparent', color: filter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista sessioni */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {loading && (
          <div className="flex justify-center py-16">
            <span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span>
          </div>
        )}
        {!loading && visible.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="text-3xl mb-3 opacity-20">💬</div>
            <p className="text-[var(--color-dim)] text-[12px]">
              {search ? 'Nessun risultato per questa ricerca.' : 'Nessuna conversazione trovata.'}
            </p>
          </div>
        )}
        {visible.map(s => (
          <SessionCard key={s.id} session={s} onOpen={openSession} onEnd={endSession} />
        ))}
      </div>
    </div>
  )
}
