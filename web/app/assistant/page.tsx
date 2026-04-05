'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'

type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number }
type AgentStatus = 'unknown' | 'active' | 'inactive' | 'starting'

const QUICK_ACTIONS = [
  'Trovami lavoro come developer',
  'Analizza il mio profilo',
  'Stato della pipeline',
  'Quante candidature oggi?',
]

function Bubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 mr-2 mt-0.5"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          🤖
        </div>
      )}
      <div className="max-w-[78%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed"
        style={{
          background: isUser ? 'var(--color-green)' : 'var(--color-card)',
          color: isUser ? '#000' : 'var(--color-bright)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
          borderBottomRightRadius: isUser ? 4 : undefined,
          borderBottomLeftRadius: !isUser ? 4 : undefined,
        }}>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
        <div className="text-[9px] mt-1 opacity-40 text-right">
          {new Date(msg.ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 mr-2"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>🤖</div>
      <div className="px-4 py-3 rounded-2xl" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderBottomLeftRadius: 4 }}>
        <div className="flex items-center gap-1">
          {[0, 0.2, 0.4].map((delay, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--color-muted)', animation: `pulse-dot 1.4s ease-in-out ${delay}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('unknown')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchMessages = useCallback(async () => {
    const res = await fetch('/api/assistente/chat?after=0').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
  }, [])

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/assistente/status').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setAgentStatus(data.active ? 'active' : 'inactive')
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchMessages()
    const si = setInterval(fetchStatus, 5000)
    const cm = setInterval(fetchMessages, 3000)
    return () => { clearInterval(si); clearInterval(cm) }
  }, [fetchStatus, fetchMessages])

  const prevCount = useRef(0)
  useEffect(() => {
    if (messages.length > prevCount.current)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    prevCount.current = messages.length
  }, [messages])

  const startAgent = async () => {
    setAgentStatus('starting')
    await fetch('/api/assistente/start', { method: 'POST' }).catch(() => null)
    setTimeout(fetchStatus, 3000)
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return
    setSending(true)
    setInput('')
    await fetch('/api/assistente/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => null)
    await fetchMessages()
    setSending(false)
    inputRef.current?.focus()
  }

  const isWaiting = messages.length > 0 && messages[messages.length - 1].role === 'user'

  return (
    <div className="min-h-screen flex flex-col" style={{ position: 'relative', zIndex: 1, animation: 'fade-in 0.35s ease both' }}>
      <h1 className="sr-only">Assistente</h1>
      {/* Header */}
      <div className="border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ background: 'var(--color-panel)' }}>
        <span className="text-xl">🤖</span>
        <div className="flex-1">
          <span className="text-[13px] font-bold text-[var(--color-white)]">Assistente</span>
          <span className="ml-2 text-[9px] font-semibold tracking-widest uppercase"
            style={{ color: agentStatus === 'active' ? 'var(--color-green)' : 'var(--color-dim)' }}>
            {agentStatus === 'unknown' ? '…' : agentStatus === 'active' ? '● attivo' : agentStatus === 'starting' ? '↻ avvio…' : '○ inattivo'}
          </span>
        </div>
        <Link href="/dashboard" className="text-[10px] no-underline transition-colors"
          style={{ color: 'var(--color-dim)' }}>← dashboard</Link>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-auto px-4 py-4 max-w-2xl w-full mx-auto">
        {agentStatus === 'inactive' && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-4 opacity-30">🤖</div>
            <p className="text-[var(--color-muted)] text-[13px] mb-4">L&apos;Assistente non è attivo.</p>
            <button onClick={startAgent}
              className="px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-wide"
              style={{ background: 'var(--color-green)', color: '#000', cursor: 'pointer' }}>
              Avvia Assistente
            </button>
          </div>
        )}
        {messages.length === 0 && agentStatus === 'active' && (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-[var(--color-muted)] text-[12px] mb-6">Ciao! Come posso aiutarti oggi?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {QUICK_ACTIONS.map(a => (
                <button key={a} onClick={() => sendMessage(a)}
                  className="px-3 py-1.5 rounded-full text-[11px] border transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-card)' }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <Bubble key={`${msg.ts}-${i}`} msg={msg} />)}
        {isWaiting && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] px-4 py-3 flex-shrink-0 max-w-2xl w-full mx-auto"
        style={{ background: 'var(--color-panel)' }}>
        <form onSubmit={e => { e.preventDefault(); sendMessage(input) }}
          className="flex items-center gap-2 border border-[var(--color-border)] rounded-2xl px-4 py-2.5"
          style={{ background: 'var(--color-card)' }}>
          <input ref={inputRef} type="text" value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={agentStatus !== 'active' ? 'Avvia prima l\'assistente…' : 'Scrivi un messaggio…'}
            disabled={sending || agentStatus !== 'active'}
            aria-label="Scrivi un messaggio"
            className="flex-1 bg-transparent outline-none text-[12px]"
            style={{ color: 'var(--color-bright)' }} />
          <button type="submit" disabled={!input.trim() || sending || agentStatus !== 'active'}
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
            style={{
              background: input.trim() && agentStatus === 'active' ? 'var(--color-green)' : 'var(--color-border)',
              cursor: input.trim() && agentStatus === 'active' ? 'pointer' : 'default',
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={input.trim() && agentStatus === 'active' ? '#000' : 'var(--color-dim)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
