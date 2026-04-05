'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogEntry = { time: string; level: LogLevel; subsystem: string; message: string; data?: Record<string, unknown> }

const LEVEL_CFG: Record<LogLevel, { label: string; color: string }> = {
  debug: { label: 'DBG', color: 'var(--color-dim)' },
  info:  { label: 'INF', color: 'var(--color-blue, #60a5fa)' },
  warn:  { label: 'WRN', color: 'var(--color-yellow)' },
  error: { label: 'ERR', color: 'var(--color-red)' },
}

function LevelBadge({ level }: { level: LogLevel }) {
  const c = LEVEL_CFG[level] ?? LEVEL_CFG.info
  return <span className="font-mono font-bold text-[10px]" style={{ color: c.color, minWidth: 28, display: 'inline-block' }}>{c.label}</span>
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const timeShort = entry.time?.slice(11, 23) ?? ''
  return (
    <div className="px-4 py-1.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors font-mono text-[11px] cursor-pointer"
      role={entry.data ? 'button' : undefined} tabIndex={entry.data ? 0 : undefined} aria-expanded={entry.data ? expanded : undefined}
      onClick={() => entry.data && setExpanded(v => !v)}
      onKeyDown={e => { if (entry.data && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpanded(v => !v); } }}>
      <div className="flex items-center gap-3">
        <span className="text-[var(--color-dim)] flex-shrink-0" style={{ minWidth: 80 }}>{timeShort}</span>
        <LevelBadge level={entry.level} />
        <span className="text-[var(--color-cyan, #22d3ee)] flex-shrink-0" style={{ minWidth: 80 }}>[{entry.subsystem}]</span>
        <span className="text-[var(--color-muted)] truncate flex-1">{entry.message}</span>
      </div>
      {expanded && entry.data && (
        <pre className="mt-1 ml-[112px] text-[10px] text-[var(--color-dim)] whitespace-pre-wrap">{JSON.stringify(entry.data, null, 2)}</pre>
      )}
    </div>
  )
}

type FilterLevel = 'all' | LogLevel

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [dates, setDates] = useState<string[]>([])
  const [subsystems, setSubsystems] = useState<string[]>([])
  const [date, setDate] = useState('')
  const [level, setLevel] = useState<FilterLevel>('all')
  const [subsystem, setSubsystem] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 50

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t) }, [search])

  const fetchLogs = useCallback(async (append = false) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (level !== 'all') params.set('level', level)
    if (subsystem) params.set('subsystem', subsystem)
    if (debouncedSearch) params.set('search', debouncedSearch)
    params.set('limit', String(PAGE_SIZE))
    if (append) params.set('offset', String(entries.length))
    const res = await fetch(`/api/logs?${params}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    if (append) setEntries(prev => [...prev, ...(data.entries ?? [])])
    else setEntries(data.entries ?? [])
    setTotal(data.total ?? 0)
    setHasMore(data.hasMore ?? false)
    setDates(data.dates ?? [])
    setSubsystems(data.subsystems ?? [])
    if (!date && data.date) setDate(data.date)
  }, [date, level, subsystem, debouncedSearch, entries.length])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    await fetchLogs(true)
    setLoading(false)
  }, [fetchLogs, loading, hasMore])

  useEffect(() => { fetchLogs() }, [date, level, subsystem, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => fetchLogs(), 5000)
    return () => clearInterval(id)
  }, [date, level, subsystem, debouncedSearch, autoRefresh]) // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver per scroll infinito
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const LEVELS: Array<{ key: FilterLevel; label: string }> = [
    { key: 'all', label: 'tutti' }, { key: 'error', label: 'error' }, { key: 'warn', label: 'warn' },
    { key: 'info', label: 'info' }, { key: 'debug', label: 'debug' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Log</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Log</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} entry · {date}</p>
          </div>
          <button onClick={() => setAutoRefresh(v => !v)}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer"
            style={{ background: autoRefresh ? 'var(--color-green)' : 'var(--color-border)', color: autoRefresh ? '#000' : 'var(--color-muted)' }}>
            {autoRefresh ? 'auto-refresh ON' : 'auto-refresh OFF'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex gap-1">
          {LEVELS.map(l => (
            <button key={l.key} onClick={() => setLevel(l.key)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ background: level === l.key ? 'var(--color-row)' : 'transparent', color: level === l.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${level === l.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {l.label}
            </button>
          ))}
        </div>
        <select value={date} onChange={e => setDate(e.target.value)}
          aria-label="Filtra per data" className="text-[11px] px-2 py-1 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-muted)]">
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={subsystem} onChange={e => setSubsystem(e.target.value)}
          aria-label="Filtra per modulo" className="text-[11px] px-2 py-1 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-muted)]">
          <option value="">tutti i moduli</option>
          {subsystems.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="cerca..."
          aria-label="Cerca nei log" className="text-[11px] px-2 py-1 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-muted)] w-40" />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {entries.length === 0
          ? <div className="flex flex-col items-center py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun log trovato.</p></div>
          : entries.map((e, i) => <LogRow key={`${e.time}-${i}`} entry={e} />)
        }
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-3">
            <span className="text-[10px] text-[var(--color-dim)]">{loading ? 'Caricamento...' : 'Scorri per altri log'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
