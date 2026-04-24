'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useDevMode } from './SettingsMenu'

type AgentSession = { session: string; active: boolean }
type Mode = 'chat' | 'terminal'

interface Props {
  /** Prefisso sessione tmux (es. 'SCOUT', 'ANALISTA') */
  sessionPrefix: string
  /** Colore accent dell'agente */
  color: string
  /** Nome visualizzato */
  label: string
}

type LocalMsg = { role: 'user' | 'system'; text: string; ts: number }

export default function AgentInteraction({ sessionPrefix, color, label }: Props) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<Mode>('chat')
  const [messages, setMessages] = useState<LocalMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const devMode = useDevMode()

  // Se il dev mode si spegne mentre si è sul tab terminale, torna su chat.
  useEffect(() => {
    if (!devMode && mode === 'terminal') setMode('chat')
  }, [devMode, mode])

  const chatEndRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Blocca scroll body in fullscreen
  useEffect(() => {
    document.body.style.overflow = chatFullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [chatFullscreen])

  // Fetch sessioni attive per questo agente
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/team/status')
      const data = await res.json()
      const matching = (data.agents ?? [])
        .filter((a: any) => {
          const s = (a.session ?? '').toUpperCase()
          const prefix = sessionPrefix.toUpperCase()
          return s === prefix || s.startsWith(`${prefix}-`)
        })
        .map((a: any) => ({ session: a.session, active: true }))
      setSessions(matching)
      // Auto-seleziona la prima sessione se non ce n'e' una attiva
      if (matching.length > 0 && (!activeSession || !matching.some((m: AgentSession) => m.session === activeSession))) {
        setActiveSession(matching[0].session)
      }
      if (matching.length === 0) {
        setActiveSession(null)
        setOutput('')
      }
    } catch {
      setSessions([])
    }
  }, [sessionPrefix, activeSession])

  // Fetch terminal output per la sessione attiva
  const fetchTerminal = useCallback(async () => {
    if (!activeSession) return
    try {
      const res = await fetch(`/api/team/terminal?session=${encodeURIComponent(activeSession)}`)
      const data = await res.json()
      setOutput(data.output ?? '')
    } catch {
      setOutput('')
    }
  }, [activeSession])

  useEffect(() => {
    fetchSessions()
    const id = setInterval(fetchSessions, 5000)
    return () => clearInterval(id)
  }, [fetchSessions])

  useEffect(() => {
    if (activeSession) fetchTerminal()
    const id = setInterval(fetchTerminal, 3000)
    return () => clearInterval(id)
  }, [activeSession, fetchTerminal])

  // Scroll chat
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const container = chatEndRef.current?.parentElement
      if (container) container.scrollTop = container.scrollHeight
    }
    prevMsgCountRef.current = messages.length
  }, [messages])

  // Scroll terminale
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  const handleSend = async () => {
    if (!input.trim() || sending || !activeSession) return
    setSending(true)
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text, ts: Date.now() / 1000 }])
    try {
      await fetch('/api/team/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: activeSession, message: text }),
      })
      // Refresh terminale per mostrare la risposta
      setTimeout(fetchTerminal, 500)
    } catch {
      setMessages(prev => [...prev, { role: 'system', text: 'Errore: messaggio non inviato.', ts: Date.now() / 1000 }])
    }
    setSending(false)
    inputRef.current?.focus()
  }

  const hasActiveSessions = sessions.length > 0

  const chatContent = (
    <div style={{
      ...(chatFullscreen ? {
        position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#0d1117',
        display: 'flex', flexDirection: 'column' as const,
      } : { animation: 'fade-in 0.25s ease both' }),
    }}>

      {/* Tabs chat/terminale + header */}
      <div className="border border-[var(--color-border)] overflow-hidden"
        style={{
          background: 'var(--color-card)',
          borderRadius: chatFullscreen ? '0' : '12px 12px 0 0',
          ...(chatFullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' as const } : {}),
        }}>
        <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{ background: color, animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMode('chat')}
                className="text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer px-2 py-0.5 rounded"
                style={{
                  color: mode === 'chat' ? color : 'var(--color-dim)',
                  background: mode === 'chat' ? `${color}15` : 'transparent',
                }}>
                chat
              </button>
              {devMode && (
                <button
                  onClick={() => setMode('terminal')}
                  className="text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer px-2 py-0.5 rounded"
                  style={{
                    color: mode === 'terminal' ? color : 'var(--color-dim)',
                    background: mode === 'terminal' ? `${color}15` : 'transparent',
                  }}>
                  terminale
                </button>
              )}
            </div>
            {/* Selettore sessione se > 1 */}
            {sessions.length > 1 && (
              <select
                value={activeSession ?? ''}
                onChange={e => setActiveSession(e.target.value)}
                className="text-[10px] bg-[var(--color-deep)] border border-[var(--color-border)] rounded px-2 py-0.5 outline-none"
                style={{ color: 'var(--color-muted)' }}>
                {sessions.map(s => (
                  <option key={s.session} value={s.session}>{s.session}</option>
                ))}
              </select>
            )}
            {sessions.length === 1 && (
              <span className="text-[9px] text-[var(--color-dim)] font-mono">{activeSession}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {mode === 'chat' && messages.length > 0 && (
              <button onClick={() => setMessages([])}
                disabled={sending}
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-red)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                pulisci
              </button>
            )}
            <button onClick={() => setChatFullscreen(v => !v)}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer">
              {chatFullscreen ? 'esci' : 'espandi'}
            </button>
          </div>
        </div>

        {/* Contenuto mode-dipendente */}
        {mode === 'chat' ? (
          <div className="px-4 py-4 overflow-auto" style={{ height: chatFullscreen ? undefined : '45vh', flex: chatFullscreen ? 1 : undefined }}>
            {messages.length === 0 && !output.trim() && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-3xl mb-3 opacity-30" style={{ color }}>{'>'}_</div>
                <p className="text-[var(--color-dim)] text-[11px]">
                  Scrivi un messaggio per interagire con {label}.
                </p>
              </div>
            )}

            {/* Messaggi utente */}
            {messages.map((msg, i) => (
              <div key={`${msg.ts}-${i}`}
                className="flex mb-3 justify-end">
                <div className="max-w-[75%] px-3 py-2 rounded-lg text-[12px] leading-relaxed"
                  style={{
                    background: color,
                    color: '#000',
                    borderBottomRightRadius: '4px',
                  }}>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
                  <div className="text-[9px] mt-1 opacity-50 text-right">
                    {new Date(msg.ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {/* Output terminale come "risposta" dell'agente */}
            {output.trim() && (
              <div className="flex mb-3 justify-start">
                <div className="max-w-[90%] px-3 py-2 rounded-lg text-[11px] leading-relaxed font-mono"
                  style={{
                    background: '#1c2333',
                    color: 'var(--color-base)',
                    borderBottomLeftRadius: '4px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: chatFullscreen ? undefined : '35vh',
                    overflowY: 'auto',
                  }}>
                  {output.trim().split('\n').slice(-60).join('\n')}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        ) : (
          /* Terminale raw */
          <div ref={termRef}
            className="px-4 py-4 font-mono text-[11px] leading-relaxed overflow-auto"
            style={{
              height: chatFullscreen ? undefined : '45vh',
              flex: chatFullscreen ? 1 : undefined,
              background: '#0d1117',
              color: 'var(--color-base)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
            {output
              ? output
              : <span style={{ color: 'var(--color-dim)' }}>nessun output...</span>}
          </div>
        )}
      </div>

      {/* Input messaggio */}
      <form onSubmit={(e) => { e.preventDefault(); handleSend() }}
        className="flex items-center border border-t-0 border-[var(--color-border)] overflow-hidden"
        style={{
          background: '#0d1117',
          borderRadius: chatFullscreen ? '0' : '0 0 12px 12px',
          margin: chatFullscreen ? '0 16px 16px 16px' : undefined,
        }}>
        <input ref={inputRef} type="text" value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={activeSession ? `Messaggio a ${activeSession}...` : 'Nessuna sessione attiva'}
          disabled={sending || !activeSession}
          className="flex-1 px-4 py-3 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--color-bright)' }} />
        <button type="submit" disabled={!input.trim() || sending || !activeSession}
          className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors"
          style={{
            color: !input.trim() || sending || !activeSession ? 'var(--color-dim)' : color,
            cursor: !input.trim() || sending || !activeSession ? 'default' : 'pointer',
          }}>
          {sending ? '...' : 'invia'}
        </button>
      </form>
    </div>
  )

  return (
    <div className="mt-10 pt-8 border-t border-[var(--color-border)]">
      <div className="flex items-center justify-between mb-4 cursor-pointer select-none" onClick={() => setCollapsed(v => !v)}>
        <div className="flex items-center gap-3">
          <div className="section-label" style={{ marginBottom: 0 }}>Interazione</div>
          {hasActiveSessions && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color, animation: 'pulse-dot 2s ease-in-out infinite' }} />
              <span className="text-[9px] font-semibold tracking-widest uppercase" style={{ color }}>
                {sessions.length} {sessions.length === 1 ? 'sessione' : 'sessioni'}
              </span>
            </div>
          )}
          {!hasActiveSessions && (
            <span className="text-[10px] text-[var(--color-dim)]">nessuna sessione attiva</span>
          )}
        </div>
        <span className="text-[10px] text-[var(--color-dim)]">{collapsed ? '>' : 'v'}</span>
      </div>

      {!collapsed && hasActiveSessions && (
        chatFullscreen
          ? createPortal(chatContent, document.body)
          : chatContent
      )}

      {!collapsed && !hasActiveSessions && (
        <div className="flex flex-col items-center justify-center py-10 text-center bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
          <div className="text-2xl mb-2 opacity-20" style={{ color }}>{'>'}_</div>
          <p className="text-[var(--color-dim)] text-[11px]">
            Nessuna sessione {label} attiva.
          </p>
          <p className="text-[var(--color-dim)] text-[10px] mt-1">
            Avvia il team dalla pagina <span style={{ color: 'var(--color-yellow)' }}>Team</span> per interagire.
          </p>
        </div>
      )}
    </div>
  )
}
