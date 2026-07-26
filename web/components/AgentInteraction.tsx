'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useIsCloud } from '@/app/hooks/useIsCloud'
import { useLocale } from '@/lib/use-locale'
import type { Locale } from '@/i18n/config'
import { intlTag } from '@/lib/locale-tag';

const T: Record<Locale, {
  chat: string
  clear: string
  exit: string
  expand: string
  send: string
  sendError: string
  writeToInteract: (label: string) => string
  messageTo: (session: string) => string
  noActiveSession: string
  interaction: string
  sessions: (n: number) => string
  noActiveSessionShort: string
  noSessionActiveFor: (label: string) => string
  startTeamFrom: (team: React.ReactNode) => React.ReactNode
  teamLabel: string
}> = {
  it: {
    chat: 'chat',
    clear: 'pulisci',
    exit: 'esci',
    expand: 'espandi',
    send: 'invia',
    sendError: 'Errore: messaggio non inviato.',
    writeToInteract: (label) => `Scrivi un messaggio per interagire con ${label}.`,
    messageTo: (session) => `Messaggio a ${session}...`,
    noActiveSession: 'Nessuna sessione attiva',
    interaction: 'Interazione',
    sessions: (n) => (n === 1 ? 'sessione' : 'sessioni'),
    noActiveSessionShort: 'nessuna sessione attiva',
    noSessionActiveFor: (label) => `Nessuna sessione ${label} attiva.`,
    startTeamFrom: (team) => <>Avvia il team dalla pagina {team} per interagire.</>,
    teamLabel: 'Team',
  },
  en: {
    chat: 'chat',
    clear: 'clear',
    exit: 'exit',
    expand: 'expand',
    send: 'send',
    sendError: 'Error: message not sent.',
    writeToInteract: (label) => `Write a message to interact with ${label}.`,
    messageTo: (session) => `Message to ${session}...`,
    noActiveSession: 'No active session',
    interaction: 'Interaction',
    sessions: (n) => (n === 1 ? 'session' : 'sessions'),
    noActiveSessionShort: 'no active session',
    noSessionActiveFor: (label) => `No active ${label} session.`,
    startTeamFrom: (team) => <>Start the team from the {team} page to interact.</>,
    teamLabel: 'Team',
  },
  es: {
    chat: 'chat',
    clear: 'limpiar',
    exit: 'salir',
    expand: 'expandir',
    send: 'enviar',
    sendError: 'Error: mensaje no enviado.',
    writeToInteract: (label) => `Escribe un mensaje para interactuar con ${label}.`,
    messageTo: (session) => `Mensaje a ${session}...`,
    noActiveSession: 'Ninguna sesión activa',
    interaction: 'Interacción',
    sessions: (n) => (n === 1 ? 'sesión' : 'sesiones'),
    noActiveSessionShort: 'ninguna sesión activa',
    noSessionActiveFor: (label) => `Ninguna sesión ${label} activa.`,
    startTeamFrom: (team) => <>Inicia el equipo desde la página {team} para interactuar.</>,
    teamLabel: 'Team',
  },
  fr: {
    chat: 'chat',
    clear: 'effacer',
    exit: 'quitter',
    expand: 'agrandir',
    send: 'envoyer',
    sendError: 'Erreur : message non envoyé.',
    writeToInteract: (label) => `Écrivez un message pour interagir avec ${label}.`,
    messageTo: (session) => `Message à ${session}...`,
    noActiveSession: 'Aucune session active',
    interaction: 'Interaction',
    sessions: (n) => (n === 1 ? 'session' : 'sessions'),
    noActiveSessionShort: 'aucune session active',
    noSessionActiveFor: (label) => `Aucune session ${label} active.`,
    startTeamFrom: (team) => <>Démarrez l’équipe depuis la page {team} pour interagir.</>,
    teamLabel: 'Team',
  },
  de: {
    chat: 'chat',
    clear: 'leeren',
    exit: 'schließen',
    expand: 'erweitern',
    send: 'senden',
    sendError: 'Fehler: Nachricht nicht gesendet.',
    writeToInteract: (label) => `Schreibe eine Nachricht, um mit ${label} zu interagieren.`,
    messageTo: (session) => `Nachricht an ${session}...`,
    noActiveSession: 'Keine aktive Sitzung',
    interaction: 'Interaktion',
    sessions: (n) => (n === 1 ? 'Sitzung' : 'Sitzungen'),
    noActiveSessionShort: 'keine aktive Sitzung',
    noSessionActiveFor: (label) => `Keine aktive ${label}-Sitzung.`,
    startTeamFrom: (team) => <>Starte das Team von der Seite {team}, um zu interagieren.</>,
    teamLabel: 'Team',
  },
  hu: {
    chat: 'chat',
    clear: 'törlés',
    exit: 'kilépés',
    expand: 'kibontás',
    send: 'küldés',
    sendError: 'Hiba: az üzenet nem lett elküldve.',
    writeToInteract: (label) => `Írj egy üzenetet a(z) ${label} eléréséhez.`,
    messageTo: (session) => `Üzenet ide: ${session}...`,
    noActiveSession: 'Nincs aktív munkamenet',
    interaction: 'Interakció',
    sessions: () => 'munkamenet',
    noActiveSessionShort: 'nincs aktív munkamenet',
    noSessionActiveFor: (label) => `Nincs aktív ${label} munkamenet.`,
    startTeamFrom: (team) => <>Indítsd el a csapatot a(z) {team} oldalról az interakcióhoz.</>,
    teamLabel: 'Team',
  },
  pt: {
    chat: 'chat',
    clear: 'limpar',
    exit: 'sair',
    expand: 'expandir',
    send: 'enviar',
    sendError: 'Erro: mensagem não enviada.',
    writeToInteract: (label) => `Escreva uma mensagem para interagir com ${label}.`,
    messageTo: (session) => `Mensagem para ${session}...`,
    noActiveSession: 'Nenhuma sessão ativa',
    interaction: 'Interação',
    sessions: (n) => (n === 1 ? 'sessão' : 'sessões'),
    noActiveSessionShort: 'nenhuma sessão ativa',
    noSessionActiveFor: (label) => `Nenhuma sessão ${label} ativa.`,
    startTeamFrom: (team) => <>Inicie a equipe a partir da página {team} para interagir.</>,
    teamLabel: 'Team',
  },
}

type AgentSession = { session: string; active: boolean }

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
  // [JHT-DASHBOARD-SPLIT] Questa è una superficie di INTERAZIONE (chat + invio
  // a tmux): zero dati in lettura. Sul cloud non esiste → niente widget, niente
  // polling /api/team/status. La pagina-agente resta (monitoraggio read-only),
  // sparisce solo la sezione "Interazione".
  //
  // La lettura del terminale non c'è più: /api/team/terminal e
  // /api/team/terminal/open sono state rimosse il 25/07 con le altre route di
  // controllo del team, perché il comando passa dal desktop. Restavano qui un
  // pannello che si riempiva di nulla e un bottone che apriva nulla.
  const isCloud = useIsCloud()
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<LocalMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const locale = useLocale()
  const t = T[locale]

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Blocca scroll body in fullscreen
  useEffect(() => {
    document.body.style.overflow = chatFullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [chatFullscreen])

  // Fetch sessioni attive per questo agente
  const fetchSessions = useCallback(async () => {
    if (isCloud === true) { setSessions([]); return }
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
      }
    } catch {
      setSessions([])
    }
  }, [sessionPrefix, activeSession, isCloud])

  // Poll delle sessioni: pausa quando il tab non è visibile. La lezione del
  // 2026-05-22 vale ancora — 1500ms fissi senza visibility check facevano
  // 2400 req/h con la dashboard aperta H24, ≈30 GB di egress Vercel al mese
  // (docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md).
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // tab hidden: poll lentissimo (60s) per ricarica veloce al rientro
        timer = setTimeout(tick, 60_000)
        return
      }
      await fetchSessions()
      timer = setTimeout(tick, 5000)
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [fetchSessions])

  // Scroll chat
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const container = chatEndRef.current?.parentElement
      if (container) container.scrollTop = container.scrollHeight
    }
    prevMsgCountRef.current = messages.length
  }, [messages])


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
    } catch {
      setMessages(prev => [...prev, { role: 'system', text: t.sendError, ts: Date.now() / 1000 }])
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

      {/* Header della chat */}
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
              <span
                className="text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded"
                style={{ color, background: `${color}15` }}>
                {t.chat}
              </span>
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
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                disabled={sending}
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-red)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                {t.clear}
              </button>
            )}
            <button onClick={() => setChatFullscreen(v => !v)}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer">
              {chatFullscreen ? t.exit : t.expand}
            </button>
          </div>
        </div>

        {/* Chat */}
        <div className="px-4 py-4 overflow-auto" style={{ height: chatFullscreen ? undefined : '45vh', flex: chatFullscreen ? 1 : undefined }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-3xl mb-3 opacity-30" style={{ color }}>{'>'}_</div>
              <p className="text-[var(--color-dim)] text-[11px]">
                {t.writeToInteract(label)}
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
                  {new Date(msg.ts * 1000).toLocaleTimeString(intlTag(locale), { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          <div ref={chatEndRef} />
        </div>
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
          placeholder={activeSession ? t.messageTo(activeSession) : t.noActiveSession}
          disabled={sending || !activeSession}
          className="flex-1 px-4 py-3 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--color-bright)' }} />
        <button type="submit" disabled={!input.trim() || sending || !activeSession}
          className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors"
          style={{
            color: !input.trim() || sending || !activeSession ? 'var(--color-dim)' : color,
            cursor: !input.trim() || sending || !activeSession ? 'default' : 'pointer',
          }}>
          {sending ? '...' : t.send}
        </button>
      </form>
    </div>
  )

  // [JHT-DASHBOARD-SPLIT] Sul cloud niente sezione interazione (dopo gli hook,
  // per non violare le regole di React).
  if (isCloud === true) return null

  return (
    <div className="mt-10 pt-8 border-t border-[var(--color-border)]">
      <div className="flex items-center justify-between mb-4 cursor-pointer select-none" onClick={() => setCollapsed(v => !v)}>
        <div className="flex items-center gap-3">
          <div className="section-label" style={{ marginBottom: 0 }}>{t.interaction}</div>
          {hasActiveSessions && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color, animation: 'pulse-dot 2s ease-in-out infinite' }} />
              <span className="text-[9px] font-semibold tracking-widest uppercase" style={{ color }}>
                {sessions.length} {t.sessions(sessions.length)}
              </span>
            </div>
          )}
          {!hasActiveSessions && (
            <span className="text-[10px] text-[var(--color-dim)]">{t.noActiveSessionShort}</span>
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
            {t.noSessionActiveFor(label)}
          </p>
          <p className="text-[var(--color-dim)] text-[10px] mt-1">
            {t.startTeamFrom(<span style={{ color: 'var(--color-yellow)' }}>{t.teamLabel}</span>)}
          </p>
        </div>
      )}
    </div>
  )
}
