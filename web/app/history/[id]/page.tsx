'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'

type Message = { role: string; content: string; ts: number; name?: string }
type ConvDetail = {
  id: string; label?: string; agentId?: string; createdAt: number; updatedAt: number
  messages: Message[]; total: number; page: number; pages: number
}

const ROLE_CFG: Record<string, { label: string; color: string; align: string; bg: string }> = {
  user:      { label: 'Tu',        color: 'var(--color-blue)',  align: 'ml-auto', bg: 'rgba(0,122,255,0.08)' },
  assistant: { label: 'Assistente', color: 'var(--color-green)', align: 'mr-auto', bg: 'rgba(0,232,122,0.08)' },
  system:    { label: 'Sistema',    color: 'var(--color-dim)',   align: 'mr-auto', bg: 'rgba(255,255,255,0.03)' },
  tool:      { label: 'Tool',       color: 'var(--color-yellow)', align: 'mr-auto', bg: 'rgba(245,197,24,0.06)' },
}

function fmtTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ChatBubble({ msg }: { msg: Message }) {
  const cfg = ROLE_CFG[msg.role] ?? ROLE_CFG.system
  return (
    <div className={`max-w-[80%] ${cfg.align} rounded-lg p-3 mb-2`} style={{ background: cfg.bg, border: `1px solid ${cfg.color}22` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: cfg.color }}>
          {msg.name ? `${cfg.label} · ${msg.name}` : cfg.label}
        </span>
        {msg.ts > 0 && <span className="text-[8px] text-[var(--color-dim)]">{fmtTime(msg.ts)}</span>}
      </div>
      <pre className="text-[11px] text-[var(--color-muted)] font-mono whitespace-pre-wrap break-words m-0">{msg.content}</pre>
    </div>
  )
}

export default function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ConvDetail | null>(null)
  const [allMessages, setAllMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchPage = useCallback(async (page: number, append = false) => {
    if (append) setLoadingMore(true)
    const res = await fetch(`/api/history/${id}?page=${page}&limit=50`).catch(() => null)
    if (res?.ok) {
      const d: ConvDetail = await res.json()
      setData(d)
      setAllMessages(prev => append ? [...d.messages, ...prev] : d.messages)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [id])

  useEffect(() => { fetchPage(1) }, [fetchPage])

  useEffect(() => {
    if (!loading && allMessages.length > 0) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [loading])

  const loadOlder = () => {
    if (!data || data.page >= data.pages || loadingMore) return
    fetchPage(data.page + 1, true)
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/history" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Cronologia</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)] truncate max-w-[180px]" aria-current="page">{data?.label ?? id?.slice(0, 12)}</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">{data?.label ?? 'Conversazione'}</h1>
            {data && (
              <p className="text-[var(--color-muted)] text-[10px] mt-1">
                {data.total} messaggi · {data.agentId ? `agente: ${data.agentId} · ` : ''}{fmtDate(data.createdAt)}
              </p>
            )}
          </div>
          {data && data.pages > 1 && (
            <span className="text-[9px] text-[var(--color-dim)]">pag. {data.page}/{data.pages}</span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Caricamento…</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Conversazione non trovata.</p>
      ) : (
        <div ref={containerRef} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 max-h-[70vh] overflow-y-auto">
          {data.pages > 1 && data.page < data.pages && (
            <div className="text-center mb-4">
              <button onClick={loadOlder} disabled={loadingMore}
                className="text-[10px] px-3 py-1.5 rounded cursor-pointer transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}>
                {loadingMore ? 'Caricamento…' : `Carica messaggi precedenti (${data.total - allMessages.length} rimanenti)`}
              </button>
            </div>
          )}
          <div className="flex flex-col gap-1">
            {allMessages.length === 0
              ? <p className="text-[var(--color-dim)] text-[11px] text-center py-8">Nessun messaggio.</p>
              : allMessages.map((m, i) => <ChatBubble key={`${m.ts}-${i}`} msg={m} />)
            }
          </div>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
