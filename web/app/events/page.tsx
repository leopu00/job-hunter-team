'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type EventStream = 'lifecycle' | 'tool' | 'assistant' | 'error' | string

type LiveEvent = {
  stream: EventStream
  ts: number
  seq?: number
  data: Record<string, unknown>
  agentId?: string
  sessionId?: string
  runId?: string
  _receivedAt: number
}

const STREAM_CFG: Record<string, { label: string; color: string; border: string; icon: string }> = {
  lifecycle: { label: 'lifecycle', color: 'var(--color-green)',  border: 'rgba(0,232,122,0.3)',  icon: '⚡' },
  tool:      { label: 'tool',      color: 'var(--color-blue)',   border: 'rgba(77,159,255,0.3)',  icon: '🔧' },
  assistant: { label: 'assistant', color: 'var(--color-yellow)', border: 'rgba(245,197,24,0.3)', icon: '🤖' },
  error:     { label: 'error',     color: 'var(--color-red)',    border: 'rgba(255,69,96,0.3)',   icon: '✗' },
}

function streamCfg(stream: string) {
  return STREAM_CFG[stream] ?? { label: stream, color: 'var(--color-muted)', border: 'var(--color-border)', icon: '◆' }
}

function EventRow({ ev }: { ev: LiveEvent }) {
  const cfg = streamCfg(ev.stream)
  const time = new Date(ev.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const kindVal = ev.data?.kind as string | undefined
  const summary = kindVal
    ? `${kindVal}${ev.data?.message ? ` — ${String(ev.data.message).slice(0, 80)}` : ''}`
    : JSON.stringify(ev.data).slice(0, 100)
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors font-mono text-[11px]">
      <span className="flex-shrink-0 w-[70px] text-[var(--color-dim)]">{time}</span>
      <span className="flex-shrink-0 w-5 text-center">{cfg.icon}</span>
      <span className="flex-shrink-0 badge text-[9px]" style={{ color: cfg.color, border: `1px solid ${cfg.border}`, background: 'transparent' }}>
        {cfg.label}
      </span>
      {ev.agentId && <span className="flex-shrink-0 text-[var(--color-dim)] text-[9px]">{ev.agentId}</span>}
      <span className="flex-1 truncate text-[var(--color-muted)]">{summary}</span>
    </div>
  )
}

const MAX_EVENTS = 500
const STREAMS = ['all', 'lifecycle', 'tool', 'assistant', 'error'] as const

export default function EventsPage() {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [filter, setFilter] = useState<typeof STREAMS[number]>('all')
  const [paused, setPaused] = useState(false)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)

  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    const url = filter === 'all' ? '/api/events' : `/api/events?stream=${filter}`
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('connected', () => setConnected(true))

    es.addEventListener('event', e => {
      if (pausedRef.current) return
      try {
        const ev = JSON.parse(e.data) as Omit<LiveEvent, '_receivedAt'>
        setEvents(prev => {
          const next = [...prev, { ...ev, _receivedAt: Date.now() }]
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
        })
      } catch { /* ignore */ }
    })

    es.onerror = () => setConnected(false)

    return () => { es.close(); setConnected(false) }
  }, [filter])

  // Auto-scroll in fondo quando arrivano eventi
  const prevCount = useRef(0)
  useEffect(() => {
    if (!paused && events.length > prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCount.current = events.length
  }, [events, paused])

  const visible = filter === 'all' ? events : events.filter(e => e.stream === filter)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      {/* Header */}
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Eventi</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              <span className="inline-flex items-center gap-2">
                Eventi live
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: connected ? 'var(--color-green)' : 'var(--color-dim)', animation: connected ? 'pulse-dot 2s ease-in-out infinite' : undefined }} />
              </span>
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{visible.length} eventi · {connected ? 'connesso' : 'disconnesso'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEvents([])}
              className="text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ color: 'var(--color-dim)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>
              pulisci
            </button>
            <button onClick={() => setPaused(v => !v)}
              className="px-4 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase transition-all cursor-pointer"
              style={{ border: `1px solid ${paused ? 'rgba(245,197,24,0.4)' : 'var(--color-border)'}`, color: paused ? 'var(--color-yellow)' : 'var(--color-muted)', background: paused ? 'rgba(245,197,24,0.06)' : 'transparent' }}>
              {paused ? '▶ riprendi' : '⏸ pausa'}
            </button>
          </div>
        </div>
      </div>

      {/* Filtri stream */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STREAMS.map(s => {
          const cfg = s === 'all' ? { label: 'tutti', color: 'var(--color-bright)', icon: '◆' } : streamCfg(s)
          return (
            <button key={s} onClick={() => { setFilter(s); setEvents([]) }}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-colors cursor-pointer"
              style={{ background: filter === s ? 'var(--color-row)' : 'transparent', color: filter === s ? cfg.color : 'var(--color-dim)', border: `1px solid ${filter === s ? 'var(--color-border-glow)' : 'transparent'}` }}>
              <span>{cfg.icon}</span> {cfg.label}
            </button>
          )
        })}
      </div>

      {/* Feed eventi */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        {visible.length === 0
          ? <div className="flex flex-col items-center py-16 text-center">
              <div className="text-3xl mb-3 opacity-20">⚡</div>
              <p className="text-[var(--color-dim)] text-[12px]">{connected ? 'In attesa di eventi…' : 'Connessione SSE non attiva.'}</p>
            </div>
          : visible.map((ev, i) => <EventRow key={`${ev.ts}-${i}`} ev={ev} />)
        }
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
