'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'

type Message = { messageId?: string; role: 'user' | 'assistant' | 'system'; text: string; timestamp: number }
type SessionDetail = {
  id: string; label?: string; channelId: string; state: string; provider?: string; model?: string
  createdAtMs: number; updatedAtMs: number; durationMs: number; messageCount: number; messages: Message[]
}

const STATE_COLORS: Record<string, string> = { active: 'var(--color-green)', paused: 'var(--color-yellow)', ended: 'var(--color-dim)' }
const ROLE_COLORS: Record<string, string> = { user: 'var(--color-blue)', assistant: 'var(--color-green)', system: 'var(--color-dim)' }
const ROLE_LABELS: Record<string, string> = { user: 'Utente', assistant: 'Assistente', system: 'Sistema' }

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function StatusBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? 'var(--color-dim)'
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{state}</span>
    </span>
  )
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const color = ROLE_COLORS[msg.role] ?? 'var(--color-muted)'
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color }}>{ROLE_LABELS[msg.role] ?? msg.role}</span>
        {msg.timestamp > 0 && <span className="text-[9px] text-[var(--color-dim)]">{fmtTime(msg.timestamp)}</span>}
      </div>
      <div className="max-w-[85%] px-3 py-2 rounded-lg text-[11px] leading-relaxed"
        style={{ background: isUser ? 'rgba(88,166,255,0.1)' : msg.role === 'system' ? 'rgba(255,255,255,0.03)' : 'rgba(127,255,178,0.08)', color: 'var(--color-muted)', border: `1px solid ${isUser ? 'rgba(88,166,255,0.15)' : 'var(--color-border)'}` }}>
        <pre className="whitespace-pre-wrap font-[inherit] m-0">{msg.text}</pre>
      </div>
    </div>
  )
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const chatRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/sessions/${id}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (data?.state === 'active') { const iv = setInterval(fetchData, 5000); return () => clearInterval(iv) }
  }, [fetchData, data?.state])
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }) }, [data?.messages.length])

  async function handleStateChange(state: string) {
    await fetch(`/api/sessions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) }).catch(() => null)
    await fetchData()
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Sessioni</span>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)] truncate max-w-[120px]" aria-current="page">{data?.label ?? id?.slice(0, 8)}</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">{data?.label ?? 'Sessione'}</h1>
              {data && <StatusBadge state={data.state} />}
            </div>
            <div className="flex gap-4 mt-1 text-[10px] text-[var(--color-dim)]">
              {data?.channelId && <span>Canale: {data.channelId}</span>}
              {data?.model && <span>Modello: {data.model}</span>}
              {data && <span>Durata: {fmtDuration(data.durationMs)}</span>}
              {data && <span>{data.messageCount} messaggi</span>}
            </div>
          </div>
          {data && data.state !== 'ended' && (
            <div className="flex gap-1.5">
              {data.state === 'active' && (
                <button onClick={() => handleStateChange('paused')} className="text-[10px] px-3 py-1 rounded font-semibold cursor-pointer" style={{ background: 'rgba(255,215,0,0.15)', color: 'var(--color-yellow)' }}>Pausa</button>
              )}
              {data.state === 'paused' && (
                <button onClick={() => handleStateChange('active')} className="text-[10px] px-3 py-1 rounded font-semibold cursor-pointer" style={{ background: 'rgba(127,255,178,0.15)', color: 'var(--color-green)' }}>Riprendi</button>
              )}
              <button onClick={() => handleStateChange('ended')} className="text-[10px] px-3 py-1 rounded font-semibold cursor-pointer" style={{ background: 'rgba(255,69,96,0.15)', color: 'var(--color-red)' }}>Termina</button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse" role="status" aria-live="polite">Caricamento...</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16" role="alert">Sessione non trovata.</p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Chat Replay</p>
            <p className="text-[10px] text-[var(--color-dim)]">{data.messages.length} messaggi</p>
          </div>
          {data.messages.length > 0 ? (
            <div ref={chatRef} className="p-4 max-h-[65vh] overflow-y-auto">
              {data.messages.map((m, i) => <ChatBubble key={m.messageId ?? i} msg={m} />)}
            </div>
          ) : (
            <p className="text-[var(--color-dim)] text-[11px] text-center py-12">Nessun messaggio in questa sessione.</p>
          )}
        </div>
      )}
    </div>
  )
}
