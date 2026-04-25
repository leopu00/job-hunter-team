'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number }
type AgentStatus = 'unknown' | 'active' | 'inactive' | 'starting'

const QUICK_ACTIONS = [
  'Analizza il mio profilo',
  'Quali skill mi mancano?',
  'Suggerisci un target ruolo',
]

export default function ProfileAssistantFab() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('unknown')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(0)

  // Portal mount: il widget vive direttamente in document.body, fuori da
  // qualsiasi containing block (es. wrapper con `transform`/`will-change`
  // che intrappolerebbe `position: fixed`). Acquisisco document.body in
  // useEffect per evitare di toccarlo durante SSR.
  useEffect(() => setContainer(document.body), [])

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

  // Polling solo quando il pannello è aperto, per non sovraccaricare la
  // pagina profile quando il widget è chiuso.
  useEffect(() => {
    if (!open) return
    fetchStatus()
    fetchMessages()
    const si = setInterval(fetchStatus, 5000)
    const cm = setInterval(fetchMessages, 3000)
    return () => {
      clearInterval(si)
      clearInterval(cm)
    }
  }, [open, fetchStatus, fetchMessages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (messages.length > prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
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

  if (!container) return null

  return createPortal(
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Chiudi assistente profilo' : 'Apri assistente profilo'}
        title="Assistente profilo"
        className="fixed bottom-6 right-6 z-[9999] flex items-center justify-center w-14 h-14 rounded-full transition-all hover:scale-105 active:scale-95"
        style={{
          background: 'var(--color-green)',
          color: '#000',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,232,122,0.4), 0 0 24px rgba(0,232,122,0.35)',
        }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Chat con l'assistente del profilo"
          className="fixed bottom-24 right-6 z-[9999] flex flex-col rounded-lg border overflow-hidden"
          style={{
            width: 'min(380px, calc(100vw - 3rem))',
            height: 'min(560px, calc(100vh - 7.5rem))',
            background: 'var(--color-card)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            animation: 'fade-in 0.2s ease both',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-shrink-0"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base" aria-hidden="true">👨‍💼</span>
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-[var(--color-white)]">
                  Assistente
                </div>
                <div
                  className="text-[9px] font-semibold tracking-widest uppercase"
                  style={{
                    color:
                      agentStatus === 'active'
                        ? 'var(--color-green)'
                        : 'var(--color-dim)',
                  }}
                >
                  {agentStatus === 'unknown'
                    ? '…'
                    : agentStatus === 'active'
                    ? '● attivo'
                    : agentStatus === 'starting'
                    ? '↻ avvio…'
                    : '○ inattivo'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi assistente"
              className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--color-row)]"
              style={{ color: 'var(--color-muted)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-3 py-3"
            role="log"
            aria-live="polite"
            aria-label="Messaggi chat"
            style={{ background: 'var(--color-card)' }}
          >
            {agentStatus === 'inactive' && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="text-3xl mb-3 opacity-30" aria-hidden="true">👨‍💼</div>
                <p className="text-[var(--color-muted)] text-[12px] mb-4">
                  L&apos;Assistente non è attivo.
                </p>
                <button
                  onClick={startAgent}
                  className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer"
                  style={{ background: 'var(--color-green)', color: '#000' }}
                >
                  Avvia Assistente
                </button>
              </div>
            )}
            {messages.length === 0 && agentStatus === 'active' && (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="text-3xl mb-2" aria-hidden="true">👨‍💼</div>
                <p className="text-[var(--color-muted)] text-[11px] mb-4">
                  Ciao! Come posso aiutarti col profilo?
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a}
                      onClick={() => sendMessage(a)}
                      className="px-2.5 py-1 rounded-full text-[10px] border transition-colors duration-200 cursor-pointer"
                      style={{
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-muted)',
                        background: 'var(--color-card)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--color-border-glow)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <Bubble key={`${msg.ts}-${i}`} msg={msg} />
            ))}
            {isWaiting && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            aria-label="Invia messaggio all'assistente"
            className="border-t flex-shrink-0 px-3 py-2.5"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
          >
            <div
              className="flex items-center gap-2 border rounded-2xl px-3 py-2"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  agentStatus !== 'active' ? "Avvia prima l'assistente…" : 'Scrivi un messaggio…'
                }
                disabled={sending || agentStatus !== 'active'}
                aria-label="Scrivi un messaggio"
                className="flex-1 bg-transparent border-0 outline-none text-[12px] text-[var(--color-bright)] placeholder:text-[var(--color-dim)]"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending || agentStatus !== 'active'}
                aria-label="Invia messaggio"
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  background:
                    input.trim() && agentStatus === 'active'
                      ? 'var(--color-green)'
                      : 'var(--color-border)',
                  cursor:
                    input.trim() && agentStatus === 'active' ? 'pointer' : 'default',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  stroke={
                    input.trim() && agentStatus === 'active'
                      ? '#000'
                      : 'var(--color-dim)'
                  }
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>,
    container
  )
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex mb-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] flex-shrink-0 mr-2 mt-0.5"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          👨‍💼
        </div>
      )}
      <div
        className="max-w-[78%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed"
        style={{
          background: isUser ? 'var(--color-green)' : 'var(--color-card)',
          color: isUser ? '#000' : 'var(--color-bright)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
          borderBottomRightRadius: isUser ? 4 : undefined,
          borderBottomLeftRadius: !isUser ? 4 : undefined,
        }}
      >
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
    <div className="flex justify-start mb-2.5">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] flex-shrink-0 mr-2"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        <span aria-hidden="true">👨‍💼</span>
      </div>
      <div
        className="px-3 py-2.5 rounded-2xl"
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          borderBottomLeftRadius: 4,
        }}
      >
        <div className="flex items-center gap-1">
          {[0, 0.2, 0.4].map((delay, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: 'var(--color-muted)',
                animation: `pulse-dot 1.4s ease-in-out ${delay}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
