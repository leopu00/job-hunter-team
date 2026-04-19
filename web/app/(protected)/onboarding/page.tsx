'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

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
  candidate?: {
    experience?: Array<{ company?: string | null; role?: string | null; years?: number | string | null; summary?: string | null }> | null
    education?: Array<{ institution?: string | null; degree?: string | null; year?: number | string | null }> | null
  } | null
} | null

const WELCOME_TEXT = 'Ciao! Aiutami a configurare il mio profilo. Puoi farmi qualche domanda oppure dirmi come caricare il mio CV.'

// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()

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

  // Voice input via Web Speech API (Chrome/Safari on macOS). When the
  // user taps the microphone we open a continuous recognition session
  // in Italian and append each final transcript chunk to the input.
  // Tap again to stop. The browser handles the permission prompt on
  // first use.
  const [isRecording, setIsRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSpeechSupported(!!SR)
  }, [])

  const toggleRecording = useCallback(async () => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setSpeechError('SpeechRecognition non supportato da questo browser')
      return
    }
    if (isRecording && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
      return
    }

    // Pre-flight: forza il prompt di permesso microfono con
    // getUserMedia. In Chromium 2026 SpeechRecognition spesso non
    // chiede il permesso da sola e onerror viene chiamata con un
    // event vuoto. Con getUserMedia otteniamo un errore chiaro
    // (NotAllowedError / NotFoundError) da mostrare all'utente.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Subito chiuso — volevamo solo triggerare/verificare il permesso.
      stream.getTracks().forEach((t) => t.stop())
    } catch (err: any) {
      const name = err?.name || 'Error'
      const msg = err?.message || String(err)
      setSpeechError(`Mic ${name}: ${msg}`)
      console.error('[getUserMedia] failed', err)
      return
    }

    let rec: any
    try {
      rec = new SR()
    } catch (err: any) {
      setSpeechError(`Errore init: ${err?.message ?? err}`)
      return
    }
    rec.lang = 'it-IT'
    rec.continuous = true
    rec.interimResults = false
    rec.onstart = () => {
      setSpeechError(null)
      setIsRecording(true)
    }
    rec.onresult = (event: any) => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) finalText += r[0].transcript
      }
      if (finalText) {
        setInput((prev) => (prev ? prev + ' ' : '') + finalText.trim())
      }
    }
    rec.onend = () => {
      setIsRecording(false)
      recognitionRef.current = null
    }
    rec.onerror = (event: any) => {
      // SpeechRecognitionErrorEvent non è enumerable su tutti i
      // browser — il campo utile è event.error (stringa: 'not-allowed',
      // 'no-speech', 'audio-capture', 'network', 'aborted',
      // 'language-not-supported', 'service-not-allowed'). Loggo tutti
      // i campi possibili perché console.error(event) spesso stampa
      // solo `{}`.
      const code = event?.error || event?.name || event?.type || 'unknown'
      const msg = event?.message || ''
      setSpeechError(`Errore mic: ${code}${msg ? ' — ' + msg : ''}`)
      console.error('[SpeechRecognition]', {
        error: event?.error,
        name: event?.name,
        type: event?.type,
        message: event?.message,
        timeStamp: event?.timeStamp,
      })
      setIsRecording(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch (err: any) {
      setSpeechError(`Start fallito: ${err?.message ?? err}`)
      setIsRecording(false)
      recognitionRef.current = null
    }
  }, [isRecording])

  // Boot progress bar — the agent's first turn in chat.jsonl typically
  // lands ~50–60s after page mount (container → tmux → kimi TUI → first
  // LLM reply). A static "In attesa…" placeholder for that long feels
  // broken, so we drive a simple bar against a 60s ETA. It caps at 95%
  // until the real first message arrives, then the whole block unmounts.
  const [bootProgress, setBootProgress] = useState(0)
  const bootStartRef = useRef<number | null>(null)

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

  // ── Auto-avvio assistente (nessun welcome client-side) ──────────────────
  // Il welcome prompt viene iniettato dal boot script nel container
  // (.launcher/start-agent.sh → tmux send-keys dopo ~12s). Non mandiamo
  // più un sendText(WELCOME_TEXT) qui, altrimenti l'utente vede due
  // benvenuti sovrapposti.
  useEffect(() => {
    if (autoStartedRef.current) return
    if (status == null) return
    if (status.active) { autoStartedRef.current = true; return }
    autoStartedRef.current = true
    ;(async () => {
      await startAssistant()
      await fetchStatus()
    })()
  }, [status, startAssistant, fetchStatus])

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

  // ── Boot progress bar ────────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) return
    if (bootStartRef.current == null) bootStartRef.current = Date.now()
    const ESTIMATED_MS = 60_000
    const tick = () => {
      const elapsed = Date.now() - (bootStartRef.current ?? Date.now())
      setBootProgress(Math.min(95, (elapsed / ESTIMATED_MS) * 100))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [messages.length])

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
  // "Profilo davvero configurato" — non bastano nome + ruolo, il team
  // ha bisogno di abbastanza sostanza da poter scrivere un CV serio.
  // Minimum viable:
  //   - identità base (nome, ruolo, città, anni, email)
  //   - almeno 2 skill primarie
  //   - almeno 1 lingua
  //   - almeno 1 esperienza lavorativa
  //   - almeno 1 titolo di studio
  const hasCore = Boolean(
    profile?.name
    && profile?.target_role
    && profile?.location
    && profile?.experience_years != null
    && (profile?.positioning?.contacts?.email || profile?.email),
  )
  const skills = profile?.skills?.primary ?? []
  const languages = profile?.languages ?? []
  const experience = profile?.candidate?.experience ?? []
  const education = profile?.candidate?.education ?? []
  const hasDepth = skills.length >= 2 && languages.length >= 1 && experience.length >= 1 && education.length >= 1
  const canProceed = hasCore && hasDepth

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
        <aside className="w-[46%] flex flex-col min-w-0">
          <div className="flex-1 rounded-lg overflow-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="section-label">Profilo candidato</div>
              <LiveDot />
            </div>
            <ProfileLive profile={profile} />
          </div>

          <button
            disabled={!canProceed}
            onClick={() => { if (canProceed) router.push('/dashboard') }}
            className="mt-3 px-4 py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-opacity"
            style={{
              background: canProceed ? 'var(--color-green)' : 'var(--color-card)',
              color: canProceed ? '#000' : 'var(--color-dim)',
              border: canProceed ? 'none' : '1px solid var(--color-border)',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            {canProceed
              ? 'Vai alla dashboard →'
              : (!hasCore
                ? 'Profilo incompleto — nome, ruolo, città, anni, email'
                : `Aggiungi ancora: ${[
                  skills.length < 2 ? 'competenze (≥2)' : null,
                  languages.length < 1 ? 'lingue' : null,
                  experience.length < 1 ? 'esperienza' : null,
                  education.length < 1 ? 'titolo di studio' : null,
                ].filter(Boolean).join(', ')}`
              )}
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
            {startError && !speechError && (
              <span className="text-[9px] text-[var(--color-red)] truncate max-w-[260px]">
                {startError}
              </span>
            )}
          </div>

          {/* Modal: microfono bloccato */}
          {speechError && speechError.includes('not-allowed') && (
            <MicBlockedModal
              onRetry={() => { setSpeechError(null); void toggleRecording() }}
              onClose={() => setSpeechError(null)}
            />
          )}
          {speechError && !speechError.includes('not-allowed') && (
            <div
              className="mx-4 mt-3 mb-0 px-3 py-2 rounded-md border flex items-center justify-between gap-3"
              style={{
                background: 'rgba(232, 138, 122, 0.08)',
                borderColor: 'rgba(232, 138, 122, 0.35)',
                color: 'var(--color-red)',
              }}
            >
              <span className="text-[11px]">{speechError}</span>
              <button
                onClick={() => setSpeechError(null)}
                className="text-[10px] underline opacity-70 hover:opacity-100"
                type="button"
              >
                chiudi
              </button>
            </div>
          )}

          {/* Messaggi */}
          <div ref={chatScrollRef} className="flex-1 overflow-auto px-4 py-4 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="text-3xl mb-3 opacity-30">🤖</div>
                <p className="text-[11px] text-[var(--color-dim)] max-w-xs leading-relaxed mb-4">
                  Sto avviando l&apos;assistente… ci vogliono circa 60 secondi
                </p>
                <div
                  className="w-full max-w-[240px] h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-border)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${bootProgress}%`, background: 'var(--color-green)' }}
                  />
                </div>
                <span
                  className="text-[9.5px] text-[var(--color-dim)] mt-2"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(bootProgress)}%
                </span>
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
            {speechSupported && (
              <button type="button"
                onClick={toggleRecording}
                disabled={sending || !status?.active}
                title={isRecording ? 'Ferma registrazione' : 'Detta a voce (it-IT)'}
                className="px-3 py-3 transition-colors cursor-pointer disabled:cursor-not-allowed"
                style={{
                  color: isRecording ? 'var(--color-red)' : 'var(--color-dim)',
                  animation: isRecording ? 'pulse-dot 1.4s ease-in-out infinite' : undefined,
                }}
                aria-label={isRecording ? 'Ferma registrazione' : 'Avvia registrazione vocale'}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                </svg>
              </button>
            )}
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
  const skills = profile?.skills
    ? Object.values(profile.skills).flat().filter(Boolean)
    : []
  const langs = (profile?.languages ?? [])
    .map(l => [l.language, l.level].filter(Boolean).join(' '))
    .filter(Boolean)
  const experience = profile?.candidate?.experience ?? []
  const education = profile?.candidate?.education ?? []
  const contacts = profile?.positioning?.contacts ?? {}

  return (
    <div className="px-4 py-4 flex flex-col gap-3 text-[11px]">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" value={profile?.name} placeholder="Mario Rossi" highlight />
        <Field label="Ruolo target" value={profile?.target_role} placeholder="Es. Full Stack Developer" highlight />
        <Field label="Località" value={profile?.location} placeholder="Es. Milano, IT" />
        <Field label="Anni esperienza" value={profile?.experience_years != null ? String(profile.experience_years) : null} placeholder="Es. 5" />
        <Field label="Email" value={profile?.email ?? contacts.email ?? null} placeholder="nome@example.com" />
        <Field label="Telefono" value={contacts.phone ?? null} placeholder="+39 …" />
      </div>

      {(contacts.linkedin || contacts.github) && (
        <div className="grid grid-cols-2 gap-3">
          {contacts.linkedin && <Field label="LinkedIn" value={contacts.linkedin} />}
          {contacts.github && <Field label="GitHub" value={contacts.github} />}
        </div>
      )}

      <Section label="Competenze">
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 30).map((s, i) => (
              <span key={`${s}-${i}`} className="px-2 py-0.5 rounded text-[10px]"
                style={{ background: 'var(--color-row)', color: 'var(--color-bright)', border: '1px solid var(--color-border)' }}>
                {s}
              </span>
            ))}
            {skills.length > 30 && (
              <span className="px-2 py-0.5 text-[10px] text-[var(--color-dim)]">+{skills.length - 30}</span>
            )}
          </div>
        ) : (
          <PlaceholderChips items={['React', 'Python', 'PostgreSQL', '…']} />
        )}
      </Section>

      <Section label="Lingue">
        {langs.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {langs.map((l, i) => (
              <span key={`${l}-${i}`} className="text-[10px] text-[var(--color-bright)]">{l}</span>
            ))}
          </div>
        ) : (
          <PlaceholderChips items={['Italiano C2', 'Inglese B2']} />
        )}
      </Section>

      <Section label="Esperienza">
        {experience.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {experience.slice(0, 4).map((e, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                <span className="font-semibold">{e.role ?? '—'}</span>
                {e.company ? <span className="text-[var(--color-muted)]"> · {e.company}</span> : null}
                {e.years ? <span className="text-[var(--color-dim)]"> · {e.years} anni</span> : null}
              </li>
            ))}
            {experience.length > 4 && (
              <li className="text-[9.5px] text-[var(--color-dim)]">+{experience.length - 4} altre</li>
            )}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">Es. Senior Developer · Acme · 3 anni</div>
        )}
      </Section>

      <Section label="Titoli di studio">
        {education.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {education.slice(0, 3).map((e, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                {e.degree ?? '—'}{e.institution ? <span className="text-[var(--color-muted)]"> · {e.institution}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">Es. Laurea in Informatica · Università di …</div>
        )}
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function PlaceholderChips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s, i) => (
        <span
          key={`${s}-${i}`}
          className="px-2 py-0.5 rounded text-[10px] italic"
          style={{
            background: 'transparent',
            color: 'var(--color-border)',
            border: '1px dashed var(--color-border)',
          }}
        >
          {s}
        </span>
      ))}
    </div>
  )
}

function Field({ label, value, highlight, placeholder }: { label: string; value?: string | null; highlight?: boolean; placeholder?: string }) {
  const empty = !value
  return (
    <div className="min-w-0">
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-0.5">{label}</div>
      <div
        className="text-[11px] truncate"
        style={{
          color: empty ? 'var(--color-border)' : highlight ? 'var(--color-green)' : 'var(--color-bright)',
          fontWeight: highlight && !empty ? 600 : 400,
          fontStyle: empty ? 'italic' : 'normal',
        }}
      >
        {value ?? placeholder ?? '—'}
      </div>
    </div>
  )
}

function MicBlockedModal({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  // Chrome non espone `chrome://settings/content/microphone` via JS
  // per security — l'utente deve cliccarlo manualmente. Forniamo il
  // link come <a> così il click diretto funziona.
  const chromeSettingsUrl = 'chrome://settings/content/microphone'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-w-md w-full rounded-xl border p-6"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border-glow)' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">🎤</div>
          <div>
            <h2 className="text-[14px] font-bold text-[var(--color-bright)] mb-1">
              Microfono bloccato
            </h2>
            <p className="text-[11.5px] text-[var(--color-muted)] leading-relaxed">
              Per dettare a voce devi autorizzare Chrome a usare il microfono su questa pagina. Due modi rapidi:
            </p>
          </div>
        </div>

        <ol className="text-[11.5px] text-[var(--color-bright)] space-y-3 pl-5 list-decimal mb-5">
          <li>
            Clicca il <strong>lucchetto 🔒</strong> accanto a <code className="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> nella barra indirizzi
            → <strong>Impostazioni sito</strong> → <strong>Microfono</strong> → <strong>Consenti</strong>.
          </li>
          <li>
            In alternativa apri le impostazioni globali:
            <a
              href={chromeSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline text-[var(--color-green)] hover:text-[var(--color-bright)]"
            >
              chrome://settings/content/microphone
            </a>
            {' '}e aggiungi <code className="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">http://localhost:3000</code> a <em>Consenti</em>.
          </li>
          <li>
            Se hai anche il check a livello macOS: <strong>Impostazioni → Privacy → Microfono</strong> → spunta Chrome.
          </li>
        </ol>

        <p className="text-[10.5px] text-[var(--color-dim)] mb-4">
          Fatto uno dei passaggi, ricarica la pagina o clicca <em>Riprova</em>: Chrome ti riproporrà il prompt del microfono.
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-md text-[11px] font-semibold tracking-wide border transition-colors cursor-pointer"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Chiudi
          </button>
          <button
            onClick={onRetry}
            type="button"
            className="px-4 py-2 rounded-md text-[11px] font-bold tracking-wide transition-opacity cursor-pointer"
            style={{ background: 'var(--color-green)', color: '#000' }}
          >
            Riprova 🎤
          </button>
        </div>
      </div>
    </div>
  )
}
