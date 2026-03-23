'use client'

import { useEffect, useState, useCallback } from 'react'

type QueueItem = {
  id: string
  title: string
  company: string
  location: string
  remote_type: string
  last_checked: string
  notes: string
}

type ScoredItem = {
  id: string
  title: string
  company: string
  location: string
  remote_type: string
  total_score: number
  scored_at: string
  scored_by: string
}

type ScorerData = {
  stats: {
    queue_size: number
    scored_total: number
    scored_today: number
    excluded_today: number
    avg_score_today: number | null
  }
  queue: QueueItem[]
  recent_scored: ScoredItem[]
  recent_excluded: ScoredItem[]
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

function locLabel(item: { remote_type: string; location: string }) {
  if (item.remote_type === 'full_remote') return 'Remote'
  return (item.location ?? '').split(',')[0] || ''
}

function scoreBadge(score: number) {
  let bg = 'var(--color-red)'
  let fg = '#fff'
  if (score >= 70) { bg = 'var(--color-green)'; fg = '#000' }
  else if (score >= 50) { bg = 'var(--color-yellow)'; fg = '#000' }
  else if (score >= 40) { bg = 'var(--color-orange)'; fg = '#000' }
  return (
    <span
      className="inline-block px-1.5 rounded text-[9px] font-bold"
      style={{ background: bg, color: fg }}
    >
      {score}
    </span>
  )
}

function QueueRow({ p }: { p: QueueItem }) {
  const loc = locLabel(p)
  const inScoring = (p.notes ?? '').includes('IN_SCORING')
  return (
    <div
      className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0"
      style={inScoring ? { background: 'rgba(255,214,0,0.04)' } : undefined}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">#{p.id}</span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[240px]">{p.title || '—'}</span>
        {inScoring && (
          <span
            className="text-[8px] font-bold px-1.5 rounded"
            style={{ background: 'var(--color-yellow)', color: '#000', animation: 'pulse-dot 1.5s infinite' }}
          >
            IN SCORING
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">{p.company}</span>
        {loc && <span className="text-[9px] text-[var(--color-orange)] font-mono">{loc}</span>}
        <span
          className="text-[8px] px-1 rounded font-semibold"
          style={{ background: 'rgba(0,230,118,0.15)', color: 'var(--color-green)' }}
        >
          CHECKED
        </span>
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtTs(p.last_checked)}</span>
      </div>
    </div>
  )
}

function ScoredRow({ p }: { p: ScoredItem }) {
  const loc = locLabel(p)
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">#{p.id}</span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[220px]">{p.title || '—'}</span>
        {scoreBadge(p.total_score)}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">{p.company}</span>
        {loc && <span className="text-[9px] text-[var(--color-orange)] font-mono">{loc}</span>}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtTs(p.scored_at)}</span>
      </div>
    </div>
  )
}

function ExcludedRow({ p }: { p: ScoredItem }) {
  const loc = locLabel(p)
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0 opacity-70">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-red)' }}>#{p.id}</span>
        <span className="text-[11px] text-[var(--color-dim)] line-through truncate max-w-[220px]">{p.title || '—'}</span>
        {scoreBadge(p.total_score)}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">{p.company}</span>
        {loc && <span className="text-[9px] text-[var(--color-orange)] font-mono">{loc}</span>}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtTs(p.scored_at)}</span>
      </div>
    </div>
  )
}

export default function ScorerLiveSection() {
  const [data, setData] = useState<ScorerData | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError] = useState(false)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/scorer/activity')
      if (!res.ok) throw new Error()
      const json = await res.json()
      setData(json)
      setLastUpdate(new Date())
      setError(false)
    } catch {
      setError(true)
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

  const { stats, queue, recent_scored, recent_excluded } = data
  const sTotal = stats.scored_today + stats.excluded_today
  const passPct = sTotal > 0 ? Math.round((stats.scored_today / sTotal) * 100) : 0
  const avgColor =
    stats.avg_score_today == null
      ? 'var(--color-dim)'
      : stats.avg_score_today >= 70
      ? 'var(--color-green)'
      : stats.avg_score_today >= 40
      ? 'var(--color-yellow)'
      : 'var(--color-orange)'

  return (
    <div className="mt-8 space-y-6" style={{ animation: 'fade-in 0.3s ease both' }}>

      {/* Stats bar */}
      <div className="flex items-center gap-1 flex-wrap">
        <div
          className="w-1.5 h-1.5 rounded-full mr-1"
          style={{ background: 'var(--color-purple)', animation: 'pulse-dot 2s ease-in-out infinite' }}
        />
        <span className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mr-3">Live</span>

        {[
          { val: stats.queue_size, label: 'in coda', color: 'var(--color-orange)' },
          { val: stats.scored_total, label: 'scored tot', color: 'var(--color-yellow)' },
          { val: stats.scored_today, label: 'scored oggi', color: 'var(--color-yellow)' },
          { val: stats.excluded_today, label: 'escluse oggi', color: 'var(--color-red)' },
        ].map(({ val, label, color }) => (
          <div
            key={label}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]"
          >
            <span className="text-[18px] font-bold leading-none" style={{ color }}>{val}</span>
            <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">{label}</span>
          </div>
        ))}

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span className="text-[18px] font-bold leading-none" style={{ color: avgColor }}>
            {stats.avg_score_today ?? '—'}
          </span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">media oggi</span>
        </div>

        {lastUpdate && (
          <span className="text-[9px] text-[var(--color-dim)] ml-auto">
            agg. {lastUpdate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Grid: Coda + Scored */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Coda lavoro */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              In Coda — Checked
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,145,0,0.12)', color: 'var(--color-orange)' }}
            >
              {stats.queue_size}
            </span>
          </div>
          {queue.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">Nessuna posizione in coda</p>
          ) : (
            queue.map(p => <QueueRow key={p.id} p={p} />)
          )}
        </div>

        {/* Ultime scored */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase" style={{ color: 'var(--color-yellow)' }}>
              Ultime 10 Scored
            </span>
          </div>
          {recent_scored.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">Nessuna posizione scored</p>
          ) : (
            recent_scored.map(p => <ScoredRow key={p.id} p={p} />)
          )}
        </div>
      </div>

      {/* Escluse dallo scorer */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-semibold tracking-[0.15em] uppercase" style={{ color: 'var(--color-red)' }}>
            Ultime 10 Escluse (score &lt; 40)
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(244,67,54,0.12)', color: 'var(--color-red)' }}
          >
            {stats.excluded_today} oggi
          </span>
        </div>

        {/* Ratio bar scored/escluse */}
        {sTotal > 0 && (
          <div className="flex items-center gap-2 mb-3 text-[9px] font-mono">
            <span style={{ color: 'var(--color-yellow)' }}>{stats.scored_today} scored</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-red)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${passPct}%`, background: 'var(--color-yellow)' }}
              />
            </div>
            <span style={{ color: 'var(--color-red)' }}>{stats.excluded_today} escluse</span>
            <span className="text-[var(--color-dim)]">({passPct}% pass)</span>
          </div>
        )}

        {recent_excluded.length === 0 ? (
          <p className="text-[10px] text-[var(--color-dim)] py-2 text-center">Nessuna esclusione recente</p>
        ) : (
          recent_excluded.map(p => <ExcludedRow key={p.id} p={p} />)
        )}
      </div>

    </div>
  )
}
