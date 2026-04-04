'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'

type Message = { role: 'user' | 'assistant'; content: string; timestamp: number }
type Suggestion = { label: string; prompt: string }

function ChatBubble({ msg }: { msg: Message }) {
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
  const [messages, setMessages] = useState<Message[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(async () => {
    const res = await fetch('/api/ai-assistant').catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setMessages(data.history ?? []); setSuggestions(data.suggestions ?? []);
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput(''); setSending(true);
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: Date.now() }]);
    const res = await fetch('/api/ai-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, timestamp: data.timestamp }]);
    }
    setSending(false);
  }

  return (
    <div className="flex flex-col" style={{ animation: 'fade-in 0.35s ease both', height: 'calc(100vh - 40px)' }}>
      <div className="pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" />
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-white)]">AI Assistant</h1>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 px-2">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--color-dim)] text-[12px] mb-4">Come posso aiutarti nella tua ricerca lavoro?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map(s => (
                <button key={s.label} onClick={() => send(s.prompt)}
                  className="px-3 py-2 rounded-lg text-[10px] font-medium cursor-pointer transition-colors"
                  style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
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
            <button key={s.label} onClick={() => send(s.prompt)} className="px-2 py-1 rounded text-[8px] cursor-pointer"
              style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{s.label}</button>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] p-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Scrivi un messaggio..."
          className="flex-1 text-[11px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
        <button onClick={() => send()} disabled={sending || !input.trim()}
          className="px-4 py-2.5 rounded-lg text-[11px] font-bold cursor-pointer"
          style={{ background: input.trim() ? 'var(--color-green)' : 'var(--color-border)', color: input.trim() ? '#000' : 'var(--color-dim)' }}>Invia</button>
      </div>
    </div>
  )
}
