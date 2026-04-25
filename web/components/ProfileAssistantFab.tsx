'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

type Message = { role: 'user' | 'assistant'; text: string }

const MOCK_INTRO: Message[] = [
  {
    role: 'assistant',
    text: 'Ciao, sono il tuo assistente del profilo. Posso aiutarti a aggiornare le tue skill, descrivere meglio un\'esperienza o suggerirti come affinare il target di carriera. Da dove vuoi iniziare?',
  },
]

export default function ProfileAssistantFab() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(MOCK_INTRO)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Portal mount: il widget vive direttamente in document.body, fuori da
  // qualsiasi containing block (es. wrapper con `transform`/`will-change`
  // che intrappolerebbe `position: fixed`).
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  function send() {
    const text = input.trim()
    if (!text) return
    setMessages((m) => [
      ...m,
      { role: 'user', text },
      { role: 'assistant', text: '...' },
    ])
    setInput('')
  }

  if (!mounted) return null

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
            height: 'min(520px, calc(100vh - 7.5rem))',
            background: 'var(--color-card)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            animation: 'fade-in 0.2s ease both',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 border-b"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background: 'var(--color-green)',
                  boxShadow: '0 0 8px var(--color-green)',
                }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[var(--color-bright)]">
                  Assistente
                </div>
                <div className="text-[9px] tracking-wider uppercase text-[var(--color-dim)]">
                  Profilo · online
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
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
            style={{ background: 'var(--color-card)' }}
          >
            {messages.map((m, i) => (
              <ChatBubble key={i} message={m} />
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="flex items-center gap-2 px-3 py-2.5 border-t"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Scrivi all'assistente..."
              aria-label="Messaggio per l'assistente"
              className="flex-1 bg-transparent border-0 outline-none text-[12px] text-[var(--color-bright)] placeholder:text-[var(--color-dim)]"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Invia messaggio"
              className="flex items-center justify-center w-8 h-8 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:opacity-90"
              style={{
                background: input.trim() ? 'var(--color-green)' : 'var(--color-row)',
                color: input.trim() ? '#000' : 'var(--color-dim)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>,
    document.body
  )
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] px-3 py-2 rounded-lg text-[12px] leading-relaxed"
        style={{
          background: isUser ? 'var(--color-green)' : 'var(--color-panel)',
          color: isUser ? '#000' : 'var(--color-bright)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {message.text}
      </div>
    </div>
  )
}
