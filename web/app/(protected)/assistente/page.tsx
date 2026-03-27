'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useCallback } from 'react'

type Status = { active: boolean; output: string }
type Check = { id: string; label: string; ok: boolean; detail?: string; hint?: string }
type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number }

/** Render markdown leggero: **bold**, *italic*, `code`, \n */
function renderMarkdown(text: string) {
  // Split per blocchi di codice inline
  const parts = text.split(/(`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px', fontSize: '11px' }}>{part.slice(1, -1)}</code>
    }
    // Bold **text**
    const boldParts = part.split(/(\*\*[^*]+\*\*)/)
    return boldParts.map((bp, j) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>
      }
      // Italic *text*
      const italicParts = bp.split(/(\*[^*]+\*)/)
      return italicParts.map((ip, k) => {
        if (ip.startsWith('*') && ip.endsWith('*')) {
          return <em key={`${i}-${j}-${k}`}>{ip.slice(1, -1)}</em>
        }
        return <span key={`${i}-${j}-${k}`}>{ip}</span>
      })
    })
  })
}

export default function AssistentePage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [checks, setChecks] = useState<Check[]>([])
  const [workspace, setWorkspace] = useState('')
  const [starting, setStarting] = useState(false)
  const [startMsg, setStartMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  // Blocca scroll del body quando chat è fullscreen
  useEffect(() => {
    document.body.style.overflow = chatFullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [chatFullscreen])
  const chatEndRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasWorkspace = workspace.trim().length > 0
  const isActive = status?.active ?? false

  // Fetch stato agente
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/assistente/status')
      const data: Status = await res.json()
      setStatus(data)
    } catch {
      setStatus({ active: false, output: '' })
    }
  }, [])

  // Fetch check prerequisiti
  const fetchChecks = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/assistente/check')
      const data = await res.json()
      setChecks(data.checks ?? [])
      if (data.workspace) setWorkspace(data.workspace)
    } catch { /* ignore */ }
    setChecking(false)
  }, [])

  // Fetch chat messages — il file è la source of truth
  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch('/api/assistente/chat?after=0')
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchChecks()
    const statusId = setInterval(fetchStatus, 5000)
    const chatId = setInterval(fetchChat, 3000)
    return () => { clearInterval(statusId); clearInterval(chatId) }
  }, [fetchStatus, fetchChecks, fetchChat])

  // Scroll chat in fondo solo quando arrivano nuovi messaggi
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const container = chatEndRef.current?.parentElement
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    }
    prevMsgCountRef.current = messages.length
  }, [messages])

  // Scroll terminale in fondo
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [status?.output, showTerminal])

  // Apri file picker
  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const res = await fetch('/api/assistente/browse', { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.folder) setWorkspace(data.folder)
    } catch { /* ignore */ }
    setBrowsing(false)
  }

  const handleStart = async () => {
    setStarting(true)
    setStartMsg(null)
    try {
      const res = await fetch('/api/assistente/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      })
      const data = await res.json()
      setStartMsg(data.message ?? (data.ok ? 'Avviato' : data.error))
      await fetchStatus()
      setTimeout(fetchChecks, 2000)
    } catch {
      setStartMsg('Errore di rete')
    } finally {
      setStarting(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || sending) return
    setSending(true)
    const text = input.trim()
    setInput('')
    try {
      await fetch('/api/assistente/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      // Refresh immediato per mostrare il messaggio user dal file
      await fetchChat()
    } catch { /* ignore */ }
    setSending(false)
    inputRef.current?.focus()
  }

  const okCount = checks.filter(c => c.ok).length
  const totalCount = checks.length

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Assistente</span>
        </div>
        <div className="mt-4 flex items-start gap-5">
          <div className="text-5xl leading-none select-none">🤖</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Assistente</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Ti aiuta a configurare il sistema e navigare la piattaforma
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Workspace */}
      <div className="mb-8">
        <div className="section-label mb-3 cursor-pointer select-none flex items-center justify-between" onClick={() => toggle('step1')}>
          <div>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
              style={{ background: hasWorkspace ? 'var(--color-green)' : 'var(--color-border)', color: hasWorkspace ? '#000' : 'var(--color-dim)' }}>
              1
            </span>
            Seleziona cartella di lavoro
            {hasWorkspace && collapsed.step1 && <span className="ml-2 text-[10px] text-[var(--color-dim)] font-mono font-normal">{workspace}</span>}
          </div>
          <span className="text-[10px] text-[var(--color-dim)]">{collapsed.step1 ? '▶' : '▼'}</span>
        </div>
        {!collapsed.step1 && <>
        <p className="text-[10px] text-[var(--color-dim)] mb-3">
          Gli agenti lavoreranno in questa cartella. Il repo del framework resta intatto.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={handleBrowse} disabled={browsing}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all flex-shrink-0"
            style={{ background: browsing ? 'var(--color-border)' : 'var(--color-green)', color: browsing ? 'var(--color-dim)' : '#000', cursor: browsing ? 'not-allowed' : 'pointer' }}>
            {browsing ? 'Seleziona…' : 'Seleziona cartella'}
          </button>
          {hasWorkspace && (
            <div className="flex items-center gap-2 px-3 py-2 rounded border font-mono text-[11px] min-w-0"
              style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-bright)' }}>
              <span className="truncate">{workspace}</span>
            </div>
          )}
        </div>
        </>}
      </div>

      {hasWorkspace && (
        <div style={{ animation: 'fade-in 0.25s ease both' }}>

          {/* Step 2: Checklist */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3 cursor-pointer select-none" onClick={() => toggle('step2')}>
              <div className="section-label">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
                  style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>2</span>
                Prerequisiti
                {totalCount > 0 && (
                  <span className="ml-2 text-[10px]" style={{ color: okCount === totalCount ? 'var(--color-green)' : 'var(--color-yellow)' }}>
                    {okCount}/{totalCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {!collapsed.step2 && (
                  <button onClick={(e) => { e.stopPropagation(); fetchChecks() }} disabled={checking}
                    className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-green)] transition-colors cursor-pointer">
                    {checking ? 'verifica…' : 'verifica tutto'}
                  </button>
                )}
                <span className="text-[10px] text-[var(--color-dim)]">{collapsed.step2 ? '▶' : '▼'}</span>
              </div>
            </div>
            {!collapsed.step2 && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {checks.map(c => (
                <div key={c.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                  <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                    style={{ background: c.ok ? 'var(--color-green)' : 'var(--color-red)' }} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[var(--color-bright)]">{c.label}</div>
                    {c.ok && c.detail && <div className="text-[10px] text-[var(--color-dim)] truncate">{c.detail}</div>}
                    {!c.ok && c.hint && <div className="text-[10px] text-[var(--color-red)]">{c.hint}</div>}
                  </div>
                </div>
              ))}
            </div>}
          </div>

          {/* Step 3: Assistente */}
          <div className="mb-6 pb-6 border-t border-[var(--color-border)] pt-6">
            <div className="flex items-center justify-between mb-3 cursor-pointer select-none" onClick={() => toggle('step3')}>
              <div className="section-label">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
                  style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>3</span>
                Assistente
              </div>
              <div className="flex items-center gap-3">
                {isActive && !collapsed.step3 && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); setShowTerminal(v => !v) }}
                      className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer">
                      {showTerminal ? 'nascondi terminale' : 'mostra terminale'}
                    </button>
                    <button onClick={async (e) => { e.stopPropagation(); await fetch('/api/assistente/terminal', { method: 'POST' }) }}
                      className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer">
                      apri powershell
                    </button>
                  </>
                )}
                <span className="text-[10px] text-[var(--color-dim)]">{collapsed.step3 ? '▶' : '▼'}</span>
              </div>
            </div>

            {!collapsed.step3 && <><div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: status == null ? 'var(--color-dim)' : isActive ? 'var(--color-green)' : 'var(--color-dim)',
                    animation: isActive ? 'pulse-dot 2s ease-in-out infinite' : undefined,
                  }} />
                <span className="text-[11px] font-semibold tracking-widest uppercase"
                  style={{ color: status == null ? 'var(--color-dim)' : isActive ? 'var(--color-green)' : 'var(--color-dim)' }}>
                  {status == null ? 'connessione…' : isActive ? 'attivo' : 'inattivo'}
                </span>
              </div>
              {!isActive && (
                <button onClick={handleStart} disabled={starting || status == null}
                  className="px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                  style={{
                    background: starting || status == null ? 'var(--color-border)' : 'var(--color-green)',
                    color: starting || status == null ? 'var(--color-dim)' : '#000',
                    cursor: starting || status == null ? 'not-allowed' : 'pointer',
                    opacity: starting ? 0.7 : 1,
                  }}>
                  {starting ? 'Avvio in corso…' : 'Avvia Assistente'}
                </button>
              )}
              {isActive && (
                <button onClick={async () => {
                    await fetch('/api/assistente/stop', { method: 'POST' })
                    await fetchStatus()
                  }}
                  className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all border border-[var(--color-red)] hover:bg-[var(--color-red)] hover:text-[#000]"
                  style={{ color: 'var(--color-red)', cursor: 'pointer' }}>
                  Ferma
                </button>
              )}
              {startMsg && <span className="text-[11px] text-[var(--color-muted)]">{startMsg}</span>}
            </div>

          {/* Chat */}
          {isActive && (() => {
            const chatContent = (
            <div style={{
              ...(chatFullscreen ? {
                position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
                background: '#0d1117',
                display: 'flex', flexDirection: 'column' as const,
              } : { animation: 'fade-in 0.25s ease both' }),
            }}>

              {/* Chat area */}
              <div className="border border-[var(--color-border)] overflow-hidden"
                style={{
                  background: 'var(--color-card)',
                  borderRadius: chatFullscreen ? '0' : '12px 12px 0 0',
                  ...(chatFullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' as const } : {}),
                }}>
                <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-green)]"
                      style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
                      chat · assistente
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {messages.length > 0 && (
                      <button onClick={async () => {
                          await fetch('/api/assistente/chat', { method: 'DELETE' })
                          setMessages([])
                        }}
                        className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-red)] transition-colors cursor-pointer">
                        pulisci
                      </button>
                    )}
                    <button onClick={() => setChatFullscreen(v => !v)}
                      className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer">
                      {chatFullscreen ? 'esci' : 'espandi'}
                    </button>
                  </div>
                </div>

                <div className="px-4 py-4 overflow-auto" style={{ height: chatFullscreen ? undefined : '45vh', flex: chatFullscreen ? 1 : undefined }}>
                  {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <div className="text-3xl mb-3 opacity-30">🤖</div>
                      <p className="text-[var(--color-dim)] text-[11px]">
                        Scrivi un messaggio per iniziare la conversazione.
                      </p>
                    </div>
                  )}

                  {messages.map((msg, i) => (
                    <div key={`${msg.ts}-${i}`}
                      className={`flex mb-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[75%] px-3 py-2 rounded-lg text-[12px] leading-relaxed"
                        style={{
                          background: msg.role === 'user' ? 'var(--color-green)' : '#1c2333',
                          color: msg.role === 'user' ? '#000' : 'var(--color-bright)',
                          borderBottomRightRadius: msg.role === 'user' ? '4px' : undefined,
                          borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : undefined,
                        }}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderMarkdown(msg.text)}</div>
                        <div className="text-[9px] mt-1 opacity-50 text-right">
                          {new Date(msg.ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Indicatore "sta pensando" */}
                  {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                    <div className="flex justify-start mb-3">
                      <div className="px-4 py-3 rounded-lg text-[12px]" style={{ background: '#1c2333', borderBottomLeftRadius: '4px' }}>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.2s infinite' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.4s infinite' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Input chat */}
              <form onSubmit={(e) => { e.preventDefault(); handleSend() }}
                className="flex items-center border border-t-0 border-[var(--color-border)] overflow-hidden"
                style={{ background: '#0d1117', borderRadius: chatFullscreen ? '0' : '0 0 12px 12px', margin: chatFullscreen ? '0 16px 16px 16px' : undefined }}>
                <input ref={inputRef} type="text" value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Scrivi un messaggio..."
                  disabled={sending}
                  className="flex-1 px-4 py-3 text-[12px] bg-transparent outline-none"
                  style={{ color: 'var(--color-bright)' }} />
                <button type="submit" disabled={!input.trim() || sending}
                  className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors"
                  style={{
                    color: !input.trim() || sending ? 'var(--color-dim)' : 'var(--color-green)',
                    cursor: !input.trim() || sending ? 'default' : 'pointer',
                  }}>
                  {sending ? '…' : 'invia'}
                </button>
              </form>

              {/* Terminale (toggle) — nascosto in fullscreen */}
              {showTerminal && !chatFullscreen && (
                <div className="mt-4" style={{ animation: 'fade-in 0.25s ease both' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="section-label">Terminale</div>
                    <span className="text-[9px] text-[var(--color-dim)] font-mono">sessione ASSISTENTE</span>
                  </div>
                  <div ref={termRef}
                    className="border border-[var(--color-border)] rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-auto"
                    style={{
                      height: '40vh', background: '#0d1117', color: 'var(--color-base)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderColor: 'var(--color-green)30',
                    }}>
                    {status?.output
                      ? status.output
                      : <span style={{ color: 'var(--color-dim)' }}>nessun output…</span>}
                  </div>
                </div>
              )}
            </div>
            )
            return chatFullscreen
              ? createPortal(chatContent, document.body)
              : chatContent
          })()}
          </>}
          </div>

          {/* Empty state */}
          {!isActive && status != null && !startMsg && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-4 opacity-30">🤖</div>
              <p className="text-[var(--color-muted)] text-[13px]">L&apos;Assistente non è attivo.</p>
              <p className="text-[var(--color-dim)] text-[11px] mt-1">
                Premi <span style={{ color: 'var(--color-green)' }}>Avvia Assistente</span> per iniziare.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state senza workspace */}
      {!hasWorkspace && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4 opacity-30">📁</div>
          <p className="text-[var(--color-muted)] text-[13px]">Seleziona una cartella di lavoro per iniziare.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">
            Gli agenti lavoreranno in sottocartelle separate dentro la cartella scelta.
          </p>
        </div>
      )}
    </div>
  )
}
