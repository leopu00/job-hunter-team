'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type Message = { id: number; ts: string; author: string; content: string; mentions: string[] }

const AUTHOR_COLORS: Record<string, string> = {
  Ace: 'var(--color-blue)', Dot: 'var(--color-green)', Leo: 'var(--color-yellow)',
  Gus: 'var(--color-bright)', Rex: '#c084fc', Pip: '#fb923c',
  Dan: '#22d3ee', Master: 'var(--color-red)',
}

function authorColor(name: string) {
  return AUTHOR_COLORS[name] ?? 'var(--color-muted)'
}

function MsgContent({ content }: { content: string }) {
  const parts = content.split(/(@\w+)/g)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('@')
          ? <span key={i} className="font-semibold" style={{ color: authorColor(p.slice(1)) }}>{p}</span>
          : <span key={i}>{p}</span>
      )}
    </span>
  )
}

export default function ForumPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [authors, setAuthors]   = useState<string[]>([])
  const [filter, setFilter]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [total, setTotal]       = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef  = useRef(true)

  const load = useCallback((author = filter) => {
    const qs = author ? `?author=${encodeURIComponent(author)}` : ''
    fetch(`/api/forum${qs}`).then(r => r.json()).then(d => {
      setMessages(d.messages ?? [])
      setAuthors(d.authors ?? [])
      setTotal(d.total ?? 0)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [filter])

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    const id = setInterval(() => load(), 5_000)
    return () => clearInterval(id)
  }, [load])

  // Auto-scroll to bottom when messages change (only if already near bottom)
  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-4xl flex flex-col gap-4" style={{ height: 'calc(100vh - 80px)' }}>

        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4 flex-shrink-0">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>team</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
              Forum
              {!loading && <span className="ml-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>
                {total} messaggi
              </span>}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>Autore</label>
            <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtra per autore"
              className="px-2 py-1.5 rounded text-[11px] font-mono outline-none cursor-pointer"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-bright)' }}>
              <option value="">Tutti</option>
              {authors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {/* Messages */}
        <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto rounded-xl flex flex-col gap-0"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
          {loading ? (
            <p className="p-6 text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
          ) : messages.length === 0 ? (
            <p className="p-6 text-[11px]" style={{ color: 'var(--color-dim)' }}>Nessun messaggio.</p>
          ) : (
            messages.map((m, i) => (
              <div key={m.id} className="flex gap-3 px-4 py-2.5 transition-colors"
                style={{ borderBottom: i < messages.length - 1 ? '1px solid var(--color-border)' : 'none' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-deep)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <span className="text-[9px] font-mono flex-shrink-0 mt-0.5" style={{ color: 'var(--color-dim)', minWidth: 112 }}>
                  {m.ts.slice(11, 19)}
                </span>
                <span className="text-[11px] font-bold flex-shrink-0" style={{ color: authorColor(m.author), minWidth: 48 }}>
                  {m.author}
                </span>
                <span className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  <MsgContent content={m.content} />
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <p className="text-[9px] flex-shrink-0" style={{ color: 'var(--color-dim)' }}>Aggiornamento automatico ogni 5s · ultime 200 righe</p>
      </div>
    </main>
  )
}
