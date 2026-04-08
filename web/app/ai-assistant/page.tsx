'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'
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

function ChatBubble({ msg }: { msg: AssistantChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className="max-w-[75%] px-4 py-2.5 rounded-lg" style={{
        background: isUser ? 'var(--color-green)' : 'var(--color-row)',
        color: isUser ? '#000' : 'var(--color-muted)',
        borderBottomRightRadius: isUser ? 2 : 12,
        borderBottomLeftRadius: isUser ? 12 : 2,
      }}>
        <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        <p className="text-[8px] mt-1 opacity-50">{new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </div>
  )
}

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>(AI_ASSISTANT_SUGGESTIONS)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [model, setModel] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(async () => {
    setMessages(loadStoredAssistantHistory())
    const res = await fetch('/api/ai-assistant').catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as AssistantBootstrap;
    setSuggestions(data.suggestions ?? AI_ASSISTANT_SUGGESTIONS);
    setConfigured(data.configured ?? false);
    setModel(data.model ?? '');
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages])
  useEffect(() => { saveStoredAssistantHistory(messages) }, [messages])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    if (configured === false) return;
    const previousHistory = messages;
    const userMessage: AssistantChatMessage = { role: 'user', content: msg, timestamp: Date.now() };
    setInput(''); setSending(true);
    setMessages(prev => [...prev, userMessage]);
    const res = await fetch('/api/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: previousHistory, path: window.location.pathname }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, timestamp: data.timestamp }]);
    } else {
      const data = await res?.json().catch(() => null);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.error ?? 'Il chatbot non è riuscito a rispondere in questo momento.',
        timestamp: Date.now(),
      }]);
      if (typeof data?.configured === 'boolean') setConfigured(data.configured);
    }
    setSending(false);
  }

  return (
    <div className="flex flex-col" style={{ animation: 'fade-in 0.35s ease both', height: 'calc(100vh - 40px)' }}>
      <div className="pb-4 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">AI Assistant</span>
        </nav>
        <div className="flex items-center mt-2">
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-white)]">AI Assistant</h1>
          <span className="ml-3 text-[10px]" style={{ color: configured === false ? 'var(--color-yellow)' : 'var(--color-dim)' }}>
            {configured === false ? 'offline' : model || 'online'}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 px-2">
        {configured === false && (
          <div className="mb-4 rounded-lg p-3 text-[11px]" style={{ background: 'rgba(245,197,24,0.08)', color: 'var(--color-muted)', border: '1px solid rgba(245,197,24,0.24)' }}>
            Chatbot non attivo: il server non ha una `OPENAI_API_KEY` configurata.
          </div>
        )}
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--color-dim)] text-[12px] mb-4">Ti guido nelle sezioni principali di Job Hunter Team.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map(s => (
                <button key={s.label} onClick={() => send(s.prompt)}
                  disabled={configured === false}
                  className="px-3 py-2 rounded-lg text-[10px] font-medium cursor-pointer transition-colors duration-200"
                  style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.45 : 1 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
        {sending && (
          <div className="flex justify-start mb-3">
            <div className="px-4 py-2.5 rounded-lg" style={{ background: 'var(--color-row)' }}>
              <span className="text-[11px] text-[var(--color-dim)]">Sto pensando...</span>
            </div>
          </div>
        )}
      </div>

      {messages.length > 0 && suggestions.length > 0 && (
        <div className="flex gap-1 px-2 pb-2">
          {suggestions.map(s => (
            <button key={s.label} onClick={() => send(s.prompt)} disabled={configured === false} className="px-2 py-1 rounded text-[8px] cursor-pointer transition-colors duration-200"
              style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.45 : 1 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>{s.label}</button>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] p-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={configured === false ? 'Chatbot non configurato' : 'Scrivi un messaggio...'}
          disabled={configured === false}
          className="flex-1 text-[11px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: configured === false ? 0.55 : 1 }} />
        <button onClick={() => send()} disabled={sending || !input.trim() || configured === false}
          className="px-4 py-2.5 rounded-lg text-[11px] font-bold cursor-pointer"
          style={{ background: input.trim() && configured !== false ? 'var(--color-green)' : 'var(--color-border)', color: input.trim() && configured !== false ? '#000' : 'var(--color-dim)' }}>Invia</button>
      </div>
    </div>
  )
}
