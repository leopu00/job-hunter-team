'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number }
type AssistantStatus = { active: boolean }

type Profile = {
  name?: string | null
  email?: string | null
  location?: string | null
  target_role?: string | null
  experience_years?: number | null
  skills?: Record<string, string[]> | null
  languages?: Array<{ language?: string | null; level?: string | null }> | null
  positioning?: {
    contacts?: { email?: string | null; phone?: string | null; linkedin?: string | null; github?: string | null; website?: string | null }
  } | null
} | null

const WELCOME_TEXT = 'Ciao! Aiutami a configurare il mio profilo. Puoi farmi qualche domanda oppure dirmi come caricare il mio CV.'

// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  // Profilo (sinistra, polling YAML)
  const [profile, setProfile] = useState<Profile>(null)

  // Assistente (destra, polling chat + status)
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [attached, setAttached] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const autoStartedRef = useRef(false)

  const chatScrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Profilo polling ───────────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) return
      const data = await res.json() as { profile: Profile }
      setProfile(data.profile ?? null)
    } catch { /* noop */ }
  }, [])

  // ── Chat polling ──────────────────────────────────────────────────────────
  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch('/api/assistente/chat?after=0')
      if (!res.ok) return
      const data = await res.json() as { messages?: ChatMsg[] }
      if (data.messages) setMessages(data.messages)
    } catch { /* noop */ }
  }, [])

  // ── Status polling ────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/assistente/status')
      if (!res.ok) { setStatus({ active: false }); return }
      const data = await res.json() as AssistantStatus
      setStatus(data)
    } catch {
      setStatus({ active: false })
    }
  }, [])

  // ── Start assistente ──────────────────────────────────────────────────────
  const startAssistant = useCallback(async (): Promise<boolean> => {
    setStarting(true)
    setStartError(null)
    try {
      const res = await fetch('/api/assistente/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string }
      if (!res.ok || data.ok === false) {
        setStartError(data.error ?? data.message ?? `avvio fallito (HTTP ${res.status})`)
        return false
      }
      return true
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'errore di rete')
      return false
    } finally {
      setStarting(false)
    }
  }, [])

  // ── Invia messaggio ──────────────────────────────────────────────────────
  const sendText = useCallback(async (text: string) => {
    try {
      await fetch('/api/assistente/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      await fetchChat()
    } catch { /* noop */ }
  }, [fetchChat])

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attached.length === 0) || sending) return
    setSending(true)
    const textToSend = input.trim()
    const filesToSend = [...attached]
    setInput('')
    setAttached([])

    let filePaths: string[] = []
    if (filesToSend.length > 0) {
      try {
        const formData = new FormData()
        filesToSend.forEach(f => formData.append('files', f))
        const res = await fetch('/api/assistente/upload', { method: 'POST', body: formData })
        const data = await res.json().catch(() => null) as { saved?: Array<{ name: string; path: string }> } | null
        filePaths = data?.saved?.map(f => f.path) ?? []
      } catch { /* noop */ }
    }

    let fullText = textToSend
    if (filePaths.length > 0) {
      const list = filePaths.map(p => `📎 ${p}`).join('\n')
      fullText = fullText
        ? `${fullText}\n\n[FILE ALLEGATI]\n${list}\n\nLeggili ed estrai le informazioni rilevanti per il profilo, poi aggiorna ../profile/candidate_profile.yml con quello che trovi.`
        : `Ho caricato questi documenti:\n${list}\n\nLeggili ed estrai le informazioni per il profilo, poi aggiorna ../profile/candidate_profile.yml con quello che trovi.`
    }

    if (fullText) await sendText(fullText)
    setSending(false)
  }, [input, attached, sending, sendText])

  // ── Auto-avvio assistente e welcome message ──────────────────────────────
  useEffect(() => {
    if (autoStartedRef.current) return
    if (status == null) return
    if (status.active) { autoStartedRef.current = true; return }
    // primo ingresso e assistente spento → avvio e invio welcome
    autoStartedRef.current = true
    ;(async () => {
      const ok = await startAssistant()
      if (!ok) return
      // attesa breve perché tmux e Claude CLI siano pronti a ricevere
      await new Promise(r => setTimeout(r, 3000))
      await fetchStatus()
      await sendText(WELCOME_TEXT)
    })()
  }, [status, startAssistant, sendText, fetchStatus])

  // ── Polling loops ────────────────────────────────────────────────────────
  useEffect(() => {
    fetchProfile()
    fetchStatus()
    fetchChat()
    const profileId = setInterval(fetchProfile, 2500)
    const statusId  = setInterval(fetchStatus, 5000)
    const chatId    = setInterval(fetchChat, 3000)
    return () => { clearInterval(profileId); clearInterval(statusId); clearInterval(chatId) }
  }, [fetchProfile, fetchStatus, fetchChat])

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  const prevCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > prevCountRef.current && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
    prevCountRef.current = messages.length
  }, [messages])

  // ── File handlers ────────────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) setAttached(prev => [...prev, ...files])
    e.target.value = ''
  }
  const removeAttached = (i: number) => setAttached(prev => prev.filter((_, j) => j !== i))

  // ── Completeness gate ────────────────────────────────────────────────────
  const canProceed = Boolean(profile?.name && profile?.target_role)

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto px-5 py-5" style={{ animation: 'fade-in 0.35s ease both' }}>

      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">
          Configura il tuo <span className="text-[var(--color-green)]">profilo</span>
        </h1>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
          Chatta con l&apos;assistente a destra o carica il tuo CV. Il profilo a sinistra si aggiorna da solo.
        </p>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">

        {/* ── Sinistra: Live profile ──────────────────────────────────── */}
        <aside className="w-[38%] flex flex-col min-w-0">
          <div className="flex-1 rounded-lg overflow-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="section-label">Profilo candidato</div>
              <LiveDot />
            </div>
            <ProfileLive profile={profile} />
          </div>

          <button
            disabled={!canProceed}
            className="mt-3 px-4 py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-opacity"
            style={{
              background: canProceed ? 'var(--color-green)' : 'var(--color-card)',
              color: canProceed ? '#000' : 'var(--color-dim)',
              border: canProceed ? 'none' : '1px solid var(--color-border)',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            {canProceed
              ? <Link href="/dashboard" className="no-underline text-inherit block">Vai alla dashboard →</Link>
              : 'Completa almeno nome e ruolo target'}
          </button>
        </aside>

        {/* ── Destra: Chat assistente ─────────────────────────────────── */}
        <section className="flex-1 flex flex-col min-w-0 rounded-lg overflow-hidden"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>

          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: status?.active ? 'var(--color-green)' : 'var(--color-dim)',
                  animation: status?.active ? 'pulse-dot 2s ease-in-out infinite' : undefined,
                }} />
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
                assistente ai
              </span>
              <span className="text-[9px] text-[var(--color-dim)]">
                {status == null ? '· connessione…' : status.active ? '· attivo' : starting ? '· avvio…' : '· spento'}
              </span>
            </div>
            {startError && (
              <span className="text-[9px] text-[var(--color-red)] truncate max-w-[260px]">{startError}</span>
            )}
          </div>

          {/* Messaggi */}
          <div ref={chatScrollRef} className="flex-1 overflow-auto px-4 py-4 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-3xl mb-3 opacity-30">🤖</div>
                <p className="text-[11px] text-[var(--color-dim)] max-w-xs leading-relaxed">
                  {starting ? 'Sto avviando l\'assistente…' : 'L\'assistente partirà tra un istante. Poi potrai scrivergli liberamente.'}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <ChatBubble key={`${m.ts}-${i}`} msg={m} />
            ))}
            {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
              <div className="flex justify-start mb-3">
                <div className="px-3 py-2 rounded-lg" style={{ background: '#1c2333' }}>
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.2s infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.4s infinite' }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Allegati preview */}
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
              {attached.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
                  style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <span className="truncate max-w-[160px]">{f.name}</span>
                  <button type="button" onClick={() => removeAttached(i)}
                    className="hover:text-[var(--color-red)] transition-colors cursor-pointer"
                    style={{ color: 'var(--color-dim)' }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleSend() }}
            className="flex items-center border-t border-[var(--color-border)]"
            style={{ background: 'var(--color-deep)' }}
          >
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.yaml,.yml" />
            <button type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || !status?.active}
              title="Allega CV, certificati o altri documenti"
              className="px-3 py-3 transition-colors cursor-pointer disabled:cursor-not-allowed"
              style={{ color: attached.length > 0 ? 'var(--color-green)' : 'var(--color-dim)' }}
              aria-label="Allega file">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending || !status?.active}
              placeholder={status?.active
                ? (attached.length > 0 ? `${attached.length} file allegat${attached.length === 1 ? 'o' : 'i'} — aggiungi un messaggio…` : 'Scrivi all\'assistente…')
                : 'In attesa dell\'assistente…'}
              className="flex-1 px-2 py-3 text-[12px] bg-transparent outline-none"
              style={{ color: 'var(--color-bright)' }}
            />
            <button type="submit"
              disabled={(!input.trim() && attached.length === 0) || sending || !status?.active}
              className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors disabled:cursor-not-allowed"
              style={{
                color: (!input.trim() && attached.length === 0) || sending || !status?.active ? 'var(--color-dim)' : 'var(--color-green)',
              }}>
              {sending ? '…' : 'invia'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
      <span className="text-[9px] tracking-widest uppercase text-[var(--color-dim)]">live</span>
    </span>
  )
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed"
        style={{
          background: isUser ? 'var(--color-green)' : '#1c2333',
          color: isUser ? '#000' : 'var(--color-bright)',
          borderBottomRightRadius: isUser ? '4px' : undefined,
          borderBottomLeftRadius: !isUser ? '4px' : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
        {msg.text}
      </div>
    </div>
  )
}

function ProfileLive({ profile }: { profile: Profile }) {
  if (!profile) {
    return (
      <div className="px-4 py-10 text-center">
        <div className="text-2xl mb-2 opacity-30">◯</div>
        <p className="text-[10px] text-[var(--color-dim)] max-w-[220px] mx-auto leading-relaxed">
          Il profilo è vuoto. Inizia a chattare con l&apos;assistente: i campi compariranno qui man mano.
        </p>
      </div>
    )
  }

  const skills = profile.skills
    ? Object.values(profile.skills).flat().filter(Boolean)
    : []
  const langs = (profile.languages ?? [])
    .map(l => [l.language, l.level].filter(Boolean).join(' '))
    .filter(Boolean)
  const contacts = profile.positioning?.contacts ?? {}

  return (
    <div className="px-4 py-4 flex flex-col gap-3 text-[11px]">
      <Field label="Nome" value={profile.name} highlight />
      <Field label="Ruolo target" value={profile.target_role} highlight />
      <Field label="Località" value={profile.location} />
      <Field label="Anni esperienza" value={profile.experience_years != null ? String(profile.experience_years) : null} />
      <Field label="Email" value={profile.email ?? contacts.email ?? null} />
      {contacts.phone && <Field label="Telefono" value={contacts.phone} />}
      {contacts.linkedin && <Field label="LinkedIn" value={contacts.linkedin} />}
      {contacts.github && <Field label="GitHub" value={contacts.github} />}
      {skills.length > 0 && (
        <div>
          <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-1.5">Skills</div>
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 24).map((s, i) => (
              <span key={`${s}-${i}`} className="px-2 py-0.5 rounded text-[10px]"
                style={{ background: 'var(--color-row)', color: 'var(--color-bright)', border: '1px solid var(--color-border)' }}>
                {s}
              </span>
            ))}
            {skills.length > 24 && (
              <span className="px-2 py-0.5 text-[10px] text-[var(--color-dim)]">+{skills.length - 24}</span>
            )}
          </div>
        </div>
      )}
      {langs.length > 0 && (
        <div>
          <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-1.5">Lingue</div>
          <div className="flex flex-wrap gap-1.5">
            {langs.map((l, i) => (
              <span key={`${l}-${i}`} className="text-[10px] text-[var(--color-bright)]">{l}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  const empty = !value
  return (
    <div>
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-0.5">{label}</div>
      <div className="text-[11px]" style={{
        color: empty ? 'var(--color-border)' : highlight ? 'var(--color-green)' : 'var(--color-bright)',
        fontWeight: highlight && !empty ? 600 : 400,
      }}>
        {value ?? '—'}
      </div>
    </div>
  )
}
