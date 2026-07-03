'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '@/lib/use-locale'
import type { Locale } from '@/i18n/config'
import {
  OPEN_ASSISTANT_EVENT,
  type OpenAssistantDetail,
} from '@/lib/profile-assistant-bus'

type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number }
type AgentStatus = 'unknown' | 'active' | 'inactive' | 'starting'

const LOCALE_TAG: Record<Locale, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  hu: 'hu-HU',
  pt: 'pt-PT',
}

const T: Record<string, Record<string, string>> = {
  quick_analyze: {
    it: 'Analizza il mio profilo',
    en: 'Analyze my profile',
    hu: 'Elemezd a profilomat',
    es: 'Analiza mi perfil',
    de: 'Analysiere mein Profil',
    fr: 'Analyse mon profil',
    pt: 'Analisa o meu perfil',
  },
  quick_skills: {
    it: 'Quali skill mi mancano?',
    en: 'Which skills am I missing?',
    hu: 'Milyen készségeim hiányoznak?',
    es: '¿Qué habilidades me faltan?',
    de: 'Welche Fähigkeiten fehlen mir?',
    fr: 'Quelles compétences me manquent ?',
    pt: 'Que competências me faltam?',
  },
  quick_target: {
    it: 'Suggerisci un target ruolo',
    en: 'Suggest a target role',
    hu: 'Javasolj egy cél pozíciót',
    es: 'Sugiere un puesto objetivo',
    de: 'Schlage eine Zielrolle vor',
    fr: 'Suggère un poste cible',
    pt: 'Sugere um cargo-alvo',
  },
  quick_edit: {
    it: 'Vorrei modificare il mio profilo',
    en: 'I want to edit my profile',
    hu: 'Szeretném módosítani a profilomat',
    es: 'Quiero editar mi perfil',
    de: 'Ich möchte mein Profil bearbeiten',
    fr: 'Je veux modifier mon profil',
    pt: 'Quero editar o meu perfil',
  },
  fab_close: {
    it: 'Chiudi assistente profilo',
    en: 'Close profile assistant',
    hu: 'Profil asszisztens bezárása',
    es: 'Cerrar asistente de perfil',
    de: 'Profil-Assistent schließen',
    fr: 'Fermer l’assistant de profil',
    pt: 'Fechar assistente de perfil',
  },
  fab_open: {
    it: 'Apri assistente profilo',
    en: 'Open profile assistant',
    hu: 'Profil asszisztens megnyitása',
    es: 'Abrir asistente de perfil',
    de: 'Profil-Assistent öffnen',
    fr: 'Ouvrir l’assistant de profil',
    pt: 'Abrir assistente de perfil',
  },
  fab_title: {
    it: 'Assistente profilo',
    en: 'Profile assistant',
    hu: 'Profil asszisztens',
    es: 'Asistente de perfil',
    de: 'Profil-Assistent',
    fr: 'Assistant de profil',
    pt: 'Assistente de perfil',
  },
  dialog_label: {
    it: "Chat con l'assistente del profilo",
    en: 'Chat with the profile assistant',
    hu: 'Csevegés a profil asszisztenssel',
    es: 'Chat con el asistente de perfil',
    de: 'Chat mit dem Profil-Assistenten',
    fr: 'Discussion avec l’assistant de profil',
    pt: 'Conversa com o assistente de perfil',
  },
  header_title: {
    it: 'Assistente',
    en: 'Assistant',
    hu: 'Asszisztens',
    es: 'Asistente',
    de: 'Assistent',
    fr: 'Assistant',
    pt: 'Assistente',
  },
  status_active: {
    it: '● attivo',
    en: '● active',
    hu: '● aktív',
    es: '● activo',
    de: '● aktiv',
    fr: '● actif',
    pt: '● ativo',
  },
  status_starting: {
    it: '↻ avvio…',
    en: '↻ starting…',
    hu: '↻ indítás…',
    es: '↻ iniciando…',
    de: '↻ wird gestartet…',
    fr: '↻ démarrage…',
    pt: '↻ a iniciar…',
  },
  status_inactive: {
    it: '○ inattivo',
    en: '○ inactive',
    hu: '○ inaktív',
    es: '○ inactivo',
    de: '○ inaktiv',
    fr: '○ inactif',
    pt: '○ inativo',
  },
  close_assistant: {
    it: 'Chiudi assistente',
    en: 'Close assistant',
    hu: 'Asszisztens bezárása',
    es: 'Cerrar asistente',
    de: 'Assistent schließen',
    fr: 'Fermer l’assistant',
    pt: 'Fechar assistente',
  },
  messages_label: {
    it: 'Messaggi chat',
    en: 'Chat messages',
    hu: 'Csevegés üzenetek',
    es: 'Mensajes del chat',
    de: 'Chat-Nachrichten',
    fr: 'Messages du chat',
    pt: 'Mensagens do chat',
  },
  not_active: {
    it: "L'Assistente non è attivo.",
    en: 'The Assistant is not active.',
    hu: 'Az asszisztens nem aktív.',
    es: 'El asistente no está activo.',
    de: 'Der Assistent ist nicht aktiv.',
    fr: 'L’assistant n’est pas actif.',
    pt: 'O assistente não está ativo.',
  },
  start_assistant: {
    it: 'Avvia Assistente',
    en: 'Start Assistant',
    hu: 'Asszisztens indítása',
    es: 'Iniciar asistente',
    de: 'Assistent starten',
    fr: 'Démarrer l’assistant',
    pt: 'Iniciar assistente',
  },
  greeting: {
    it: 'Ciao! Come posso aiutarti col profilo?',
    en: 'Hi! How can I help with your profile?',
    hu: 'Szia! Miben segíthetek a profiloddal?',
    es: '¡Hola! ¿Cómo puedo ayudarte con tu perfil?',
    de: 'Hallo! Wie kann ich dir bei deinem Profil helfen?',
    fr: 'Bonjour ! Comment puis-je vous aider avec votre profil ?',
    pt: 'Olá! Como posso ajudar com o teu perfil?',
  },
  send_message_form: {
    it: "Invia messaggio all'assistente",
    en: 'Send a message to the assistant',
    hu: 'Üzenet küldése az asszisztensnek',
    es: 'Enviar un mensaje al asistente',
    de: 'Nachricht an den Assistenten senden',
    fr: 'Envoyer un message à l’assistant',
    pt: 'Enviar uma mensagem ao assistente',
  },
  placeholder_start_first: {
    it: "Avvia prima l'assistente…",
    en: 'Start the assistant first…',
    hu: 'Előbb indítsd el az asszisztenst…',
    es: 'Inicia primero el asistente…',
    de: 'Starte zuerst den Assistenten…',
    fr: 'Démarrez d’abord l’assistant…',
    pt: 'Inicia primeiro o assistente…',
  },
  placeholder_write: {
    it: 'Scrivi un messaggio…',
    en: 'Write a message…',
    hu: 'Írj egy üzenetet…',
    es: 'Escribe un mensaje…',
    de: 'Schreibe eine Nachricht…',
    fr: 'Écrivez un message…',
    pt: 'Escreve uma mensagem…',
  },
  write_message: {
    it: 'Scrivi un messaggio',
    en: 'Write a message',
    hu: 'Írj egy üzenetet',
    es: 'Escribe un mensaje',
    de: 'Schreibe eine Nachricht',
    fr: 'Écrivez un message',
    pt: 'Escreve uma mensagem',
  },
  send_message: {
    it: 'Invia messaggio',
    en: 'Send message',
    hu: 'Üzenet küldése',
    es: 'Enviar mensaje',
    de: 'Nachricht senden',
    fr: 'Envoyer le message',
    pt: 'Enviar mensagem',
  },
}

export default function ProfileAssistantFab() {
  const locale = useLocale()
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k
  const [bodyContainer, setBodyContainer] = useState<HTMLElement | null>(null)
  const [sideContainer, setSideContainer] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('unknown')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(0)

  const quickActions = [tr('quick_edit'), tr('quick_analyze'), tr('quick_skills'), tr('quick_target')]

  // Due portali separati:
  // - bodyContainer: per il bottone FAB cerchio (position:fixed bottom-right,
  //   sempre visibile, sopra a tutto)
  // - sideContainer: per il pannello chat (montato come flex-item dentro
  //   #protected-side-panel, sibling del main → in-flow, niente position:
  //   fixed, niente reflow del body, header MAI toccato)
  useEffect(() => {
    setBodyContainer(document.body)
    setSideContainer(document.getElementById('protected-side-panel') ?? document.body)
  }, [])

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

  // Poll attivo solo quando il pannello e' aperto E la tab e' visibile.
  // Pre-fix (2026-05-22): interval continuava anche con tab in background,
  // contribuendo al consumo Vercel Function Invocations (vedi
  // docs/internal/2026-05-22-vercel-quota-exhaustion.md).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let statusTimer: ReturnType<typeof setTimeout> | null = null
    let messagesTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleStatus = (delay: number) => {
      if (cancelled) return
      statusTimer = setTimeout(async () => {
        if (cancelled) return
        const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
        if (!hidden) await fetchStatus()
        scheduleStatus(hidden ? 60_000 : 10_000)
      }, delay)
    }
    const scheduleMessages = (delay: number) => {
      if (cancelled) return
      messagesTimer = setTimeout(async () => {
        if (cancelled) return
        const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
        if (!hidden) await fetchMessages()
        scheduleMessages(hidden ? 30_000 : 5_000)
      }, delay)
    }

    fetchStatus()
    fetchMessages()
    scheduleStatus(10_000)
    scheduleMessages(5_000)
    return () => {
      cancelled = true
      if (statusTimer) clearTimeout(statusTimer)
      if (messagesTimer) clearTimeout(messagesTimer)
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

  const startAgent = useCallback(async () => {
    setAgentStatus('starting')
    await fetch('/api/assistente/start', { method: 'POST' }).catch(() => null)
    setTimeout(fetchStatus, 3000)
  }, [fetchStatus])

  const sendMessage = useCallback(
    async (text: string) => {
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
    },
    [sending, fetchMessages],
  )

  // Apertura esterna (bottone "Modifica" / chip "campi mancanti" → bus eventi):
  // apre il pannello e mette in coda un eventuale messaggio iniziale.
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenAssistantDetail>).detail
      setOpen(true)
      if (detail?.message) setPending(detail.message)
    }
    window.addEventListener(OPEN_ASSISTANT_EVENT, handler)
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, handler)
  }, [])

  // Flush del messaggio in coda quando il pannello è aperto. Se l'Assistente è
  // spento lo avvio, così la risposta arriva senza un click extra dell'utente.
  useEffect(() => {
    if (!open || pending == null || sending) return
    const msg = pending
    setPending(null)
    if (agentStatus === 'inactive') startAgent()
    sendMessage(msg)
  }, [open, pending, sending, agentStatus, startAgent, sendMessage])

  const isWaiting = messages.length > 0 && messages[messages.length - 1].role === 'user'

  // Bottone FAB cerchio: sempre montato in document.body, position:fixed.
  const fabButton = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={open ? tr('fab_close') : tr('fab_open')}
      title={tr('fab_title')}
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full transition-all hover:scale-105 active:scale-95"
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
  )

  // Pannello chat: block in-flow, montato dentro #protected-side-panel
  // (flex sibling del main). Su lg+ ha larghezza 40vw; su mobile copre
  // tutto lo schermo come overlay (full width). Niente position:fixed:
  // il main si stringe automaticamente via flex-1.
  const chatPanel = open && (
    <aside
      role="dialog"
      aria-label={tr('dialog_label')}
      className="flex flex-col border-l w-full lg:w-[40vw] flex-shrink-0 self-stretch sticky top-14"
      style={{
        background: 'var(--color-panel)',
        borderColor: 'var(--color-border)',
        height: 'calc(100vh - 3.5rem)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base" aria-hidden="true">👩‍💼</span>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-[var(--color-white)]">
              {tr('header_title')}
            </div>
            <div
              className="text-[9px] font-semibold tracking-widest uppercase"
              style={{
                color: agentStatus === 'active' ? 'var(--color-green)' : 'var(--color-dim)',
              }}
            >
              {agentStatus === 'unknown'
                ? '…'
                : agentStatus === 'active'
                ? tr('status_active')
                : agentStatus === 'starting'
                ? tr('status_starting')
                : tr('status_inactive')}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={tr('close_assistant')}
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
        aria-label={tr('messages_label')}
        style={{ background: 'var(--color-card)' }}
      >
        {agentStatus === 'inactive' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="text-3xl mb-3 opacity-30" aria-hidden="true">👩‍💼</div>
            <p className="text-[var(--color-muted)] text-[12px] mb-4">
              {tr('not_active')}
            </p>
            <button
              onClick={startAgent}
              className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer"
              style={{ background: 'var(--color-green)', color: '#000' }}
            >
              {tr('start_assistant')}
            </button>
          </div>
        )}
        {messages.length === 0 && agentStatus === 'active' && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="text-3xl mb-2" aria-hidden="true">👩‍💼</div>
            <p className="text-[var(--color-muted)] text-[11px] mb-4">
              {tr('greeting')}
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {quickActions.map((a) => (
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
        aria-label={tr('send_message_form')}
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
            placeholder={agentStatus !== 'active' ? tr('placeholder_start_first') : tr('placeholder_write')}
            disabled={sending || agentStatus !== 'active'}
            aria-label={tr('write_message')}
            className="flex-1 bg-transparent border-0 outline-none text-[12px] text-[var(--color-bright)] placeholder:text-[var(--color-dim)]"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || agentStatus !== 'active'}
            aria-label={tr('send_message')}
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
            style={{
              background: input.trim() && agentStatus === 'active' ? 'var(--color-green)' : 'var(--color-border)',
              cursor: input.trim() && agentStatus === 'active' ? 'pointer' : 'default',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              stroke={input.trim() && agentStatus === 'active' ? '#000' : 'var(--color-dim)'}
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
    </aside>
  )

  return (
    <>
      {bodyContainer && createPortal(fabButton, bodyContainer)}
      {chatPanel && sideContainer && createPortal(chatPanel, sideContainer)}
    </>
  )
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const locale = useLocale()
  const isUser = msg.role === 'user'
  return (
    <div className={`flex mb-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] flex-shrink-0 mr-2 mt-0.5"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          👩‍💼
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
          {new Date(msg.ts * 1000).toLocaleTimeString(LOCALE_TAG[locale] ?? 'en-US', { hour: '2-digit', minute: '2-digit' })}
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
        <span aria-hidden="true">👩‍💼</span>
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
