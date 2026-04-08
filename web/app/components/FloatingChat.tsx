'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  AI_ASSISTANT_SUGGESTIONS,
  loadStoredAssistantHistory,
  saveStoredAssistantHistory,
  type AssistantChatMessage,
  type AssistantSuggestion,
} from '@/lib/ai-assistant'

type AssistantBootstrap = {
  suggestions?: AssistantSuggestion[]
  configured?: boolean
  model?: string
}

type Message = AssistantChatMessage
type Suggestion = AssistantSuggestion

export default function FloatingChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>(AI_ASSISTANT_SUGGESTIONS)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [model, setModel] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(async () => {
    setMessages(loadStoredAssistantHistory())
    const res = await fetch('/api/ai-assistant').catch(() => null)
    if (!res?.ok) return
    const data = await res.json() as AssistantBootstrap
    setSuggestions(data.suggestions ?? AI_ASSISTANT_SUGGESTIONS)
    setConfigured(data.configured ?? false)
    setModel(data.model ?? '')
  }, [])

  useEffect(() => { if (open) fetchHistory() }, [open, fetchHistory])
  useEffect(() => { if (open) scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, open])
  useEffect(() => { saveStoredAssistantHistory(messages) }, [messages])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || sending) return
    if (configured === false) return

    const previousHistory = messages
    const userMessage: AssistantChatMessage = { role: 'user', content: msg, timestamp: Date.now() }
    setInput(''); setSending(true)
    setMessages(prev => [...prev, userMessage])
    const res = await fetch('/api/ai-assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: previousHistory, path: window.location.pathname }),
    }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, timestamp: data.timestamp }])
    } else {
      const data = await res?.json().catch(() => null)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.error ?? 'Il chatbot non è riuscito a rispondere in questo momento.',
        timestamp: Date.now(),
      }])
      if (typeof data?.configured === 'boolean') setConfigured(data.configured)
    }
    setSending(false)
  }

  return (
    <>
      <style>{`
        @keyframes chat-slide-up {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg cursor-pointer border-0 transition-all hover:opacity-90"
        style={{ background: 'var(--color-green)', color: 'var(--color-void)', zIndex: 60 }}
        aria-label={open ? 'Chiudi chat' : 'Apri AI Assistant'}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          role="complementary"
          aria-label="AI Assistant chat"
          className="fixed bottom-24 right-6 w-96 flex flex-col rounded-xl overflow-hidden shadow-2xl"
          style={{
            maxHeight: 560, zIndex: 60, animation: 'chat-slide-up 0.25s ease both',
            background: 'var(--color-deep)', border: '1px solid var(--color-border)',
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-green)' }} />
              <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-white)' }}>
                AI Assistant
              </span>
            </div>
            <div className="text-[9px]" style={{ color: configured === false ? 'var(--color-yellow)' : 'var(--color-dim)' }}>
              {configured === false ? 'offline' : model || 'online'}
            </div>
            <button onClick={() => setOpen(false)} className="cursor-pointer bg-transparent border-0 p-0 flex items-center"
              style={{ color: 'var(--color-dim)' }} aria-label="Chiudi">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 min-h-0" aria-live="polite" style={{ minHeight: 200 }}>
            {configured === false && (
              <div className="mb-4 rounded-lg p-3 text-[11px]" style={{ background: 'rgba(245,197,24,0.08)', color: 'var(--color-muted)', border: '1px solid rgba(245,197,24,0.24)' }}>
                Chatbot non attivo: manca `OPENAI_API_KEY` sul server.
              </div>
            )}
            {messages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-[12px] mb-4" style={{ color: 'var(--color-dim)' }}>Ti aiuto a capire la piattaforma e da dove iniziare.</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {suggestions.map(s => (
                    <button key={s.label} onClick={() => send(s.prompt)}
                      disabled={configured === false}
                      className="px-3 py-1.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.45 : 1 }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex mb-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] px-3 py-2 rounded-lg text-[11px] leading-relaxed"
                  style={m.role === 'user'
                    ? { background: 'var(--color-green)', color: '#000', borderBottomRightRadius: 2 }
                    : { background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderBottomLeftRadius: 2 }}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start mb-3">
                <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--color-row)' }}>
                  <span className="text-[11px]" style={{ color: 'var(--color-dim)' }}>Sto pensando...</span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions (compact) */}
          {messages.length > 0 && suggestions.length > 0 && (
            <div className="flex gap-1 px-3 pb-2 flex-wrap">
              {suggestions.map(s => (
                <button key={s.label} onClick={() => send(s.prompt)}
                  disabled={configured === false}
                  className="px-2 py-0.5 rounded text-[8px] cursor-pointer"
                  style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.45 : 1 }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 flex gap-2 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()} placeholder={configured === false ? 'Chatbot non configurato' : 'Scrivi un messaggio...'}
              aria-label="Scrivi un messaggio all'assistente"
              disabled={configured === false}
              className="flex-1 text-[11px] px-3 py-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)]"
              style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.55 : 1 }} />
            <button onClick={() => send()} disabled={sending || !input.trim() || configured === false}
              aria-label="Invia messaggio"
              className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
              style={{ background: input.trim() && configured !== false ? 'var(--color-green)' : 'var(--color-border)', color: input.trim() && configured !== false ? '#000' : 'var(--color-dim)' }}>
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
