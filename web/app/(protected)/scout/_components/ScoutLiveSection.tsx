'use client'

import { useEffect, useState, useCallback } from 'react'

type Position = {
  id: string
  title: string
  company: string
  location: string
  remote_type: string
  found_at: string
  found_by?: string
  status?: string
  notes?: string
}

type ScoutData = {
  stats: { found_today: number; total_new: number }
  queue: Position[]
  recent: Position[]
  excluded_today: Position[]
}

function fmtTs(ts: string) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return 'adesso'
  if (diffMin < 60) return `${diffMin}m fa`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h fa`
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function locLabel(p: Pick<Position, 'remote_type' | 'location'>) {
  if (p.remote_type === 'full_remote') return 'Remote'
  return (p.location ?? '').split(',')[0] || ''
}

function scoutBadge(name?: string) {
  if (!name) return ''
  return name.toUpperCase().replace('SCOUT-', 'S')
}

function FeedItem({ p, dim }: { p: Position; dim?: boolean }) {
  const loc = locLabel(p)
  return (
    <div
      className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0"
      style={{ opacity: dim ? 0.65 : 1 }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">#{p.id}</span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[260px]">{p.title || '—'}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">{p.company}</span>
        {loc && <span className="text-[9px] text-[var(--color-orange)] font-mono">{loc}</span>}
        {p.found_by && (
          <span className="text-[9px] font-bold text-[var(--color-blue)] font-mono">{scoutBadge(p.found_by)}</span>
        )}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtTs(p.found_at)}</span>
      </div>
    </div>
  )
}

function ExcludedItem({ p }: { p: Position }) {
  const loc = locLabel(p)
  const reason = (p.notes ?? '').replace(/^MOTIVO ESCLUSIONE:\s*/i, '').split('\n')[0].slice(0, 60)
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0 opacity-70">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-red)' }}>#{p.id}</span>
        <span className="text-[11px] text-[var(--color-dim)] line-through truncate max-w-[260px]">{p.title || '—'}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">{p.company}</span>
        {loc && <span className="text-[9px] text-[var(--color-orange)] font-mono">{loc}</span>}
        {reason && <span className="text-[9px]" style={{ color: 'var(--color-red)' }}>{reason}</span>}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtTs(p.found_at)}</span>
      </div>
    </div>
  )
}

export default function ScoutLiveSection() {
  const [data, setData] = useState<ScoutData | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError] = useState(false)
  const [isAgentActive, setIsAgentActive] = useState(false)

  const fetch_ = useCallback(async () => {
    const [activityResult, statusResult] = await Promise.allSettled([
      fetch('/api/scout/activity'),
      fetch('/api/team/status'),
    ])

    // Activity data
    if (activityResult.status === 'fulfilled' && activityResult.value.ok) {
      const json = await activityResult.value.json()
      setData(json)
      setLastUpdate(new Date())
      setError(false)
    } else {
      setError(true)
    }

    // Team status — controlla se SCOUT è attivo
    if (statusResult.status === 'fulfilled' && statusResult.value.ok) {
      const statusJson = await statusResult.value.json()
      const scoutActive = (statusJson.agents ?? []).some(
        (a: { session: string }) => {
          const s = a.session.toUpperCase()
          return s === 'SCOUT' || s.startsWith('SCOUT-')
        }
      )
      setIsAgentActive(scoutActive)
    }
  }, [])

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 8000)
    return () => clearInterval(id)
  }, [fetch_])

  if (error) return (
    <div className="mt-8 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-[11px] text-[var(--color-dim)]">
      Dati real-time non disponibili.
    </div>
  )

  if (!data) return (
    <div className="mt-8 flex items-center gap-2 text-[11px] text-[var(--color-dim)]">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-dim)] animate-pulse" />
      Caricamento dati live…
    </div>
  )

  const { stats, queue, recent, excluded_today } = data
  const sTotal = stats.found_today + excluded_today.length
  const passPct = sTotal > 0 ? Math.round((stats.found_today / sTotal) * 100) : 0

  return (
    <div className="mt-8 space-y-6" style={{ animation: 'fade-in 0.3s ease both' }}>

      {/* Stats bar */}
      <div className="flex items-center gap-1 flex-wrap">
        <div
          className="w-1.5 h-1.5 rounded-full mr-1"
          style={{
            background: isAgentActive ? 'var(--color-green)' : 'var(--color-dim)',
            animation: isAgentActive ? 'pulse-dot 2s ease-in-out infinite' : undefined,
          }}
        />
        <span className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mr-3">
          {isAgentActive ? 'Live' : 'Offline'}
        </span>

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span className="text-[18px] font-bold leading-none" style={{ color: 'var(--color-green)' }}>{stats.found_today}</span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">trovate oggi</span>
        </div>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span className="text-[18px] font-bold leading-none" style={{ color: 'var(--color-blue)' }}>{stats.total_new}</span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">in attesa</span>
        </div>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span className="text-[18px] font-bold leading-none" style={{ color: 'var(--color-red)' }}>{excluded_today.length}</span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">escluse oggi</span>
        </div>

        {lastUpdate && (
          <span className="text-[9px] text-[var(--color-dim)] ml-auto">
            agg. {lastUpdate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Grid: Coda + Feed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Coda lavoro */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              Coda lavoro
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(33,150,243,0.12)', color: 'var(--color-blue)' }}
            >
              {stats.total_new} new
            </span>
          </div>
          {queue.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">Nessuna posizione in attesa</p>
          ) : (
            queue.map(p => <FeedItem key={p.id} p={p} />)
          )}
        </div>

        {/* Feed ultimi 10 trovati */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              Ultime trovate
            </span>
            <span className="text-[9px] text-[var(--color-dim)]">top 10</span>
          </div>
          {recent.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">Nessuna posizione trovata</p>
          ) : (
            recent.map(p => <FeedItem key={p.id} p={p} />)
          )}
        </div>
      </div>

      {/* Sezione esclusioni */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-semibold tracking-[0.15em] uppercase" style={{ color: 'var(--color-red)' }}>
            Escluse oggi
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(244,67,54,0.12)', color: 'var(--color-red)' }}
          >
            {excluded_today.length}
          </span>
        </div>

        {/* Ratio bar */}
        {sTotal > 0 && (
          <div className="flex items-center gap-2 mb-3 text-[9px] font-mono">
            <span style={{ color: 'var(--color-green)' }}>{stats.found_today} passate</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-red)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${passPct}%`, background: 'var(--color-green)' }}
              />
            </div>
            <span style={{ color: 'var(--color-red)' }}>{excluded_today.length} escluse</span>
            <span className="text-[var(--color-dim)]">({passPct}% pass)</span>
          </div>
        )}

        {excluded_today.length === 0 ? (
          <p className="text-[10px] text-[var(--color-dim)] py-2 text-center">Nessuna esclusione oggi</p>
        ) : (
          excluded_today.map(p => <ExcludedItem key={p.id} p={p} />)
        )}
      </div>

    </div>
  )
}
