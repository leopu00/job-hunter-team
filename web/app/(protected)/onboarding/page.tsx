'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// `done` è opzionale per retrocompatibilità: messaggi vecchi senza il flag
// vengono trattati come turno finito (done=true implicito). L'agente usa
// `jht-send --partial` per i checkpoint intermedi (done=false) e mantiene
// accesi i 3 puntini finché non invia un messaggio senza --partial.
type ChatMsg = { role: 'user' | 'assistant'; text: string; ts: number; done?: boolean }
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
    experience?: Array<{ company?: string | null; role?: string | null; years?: number | string | null; summary?: string | null }> | null
    education?: Array<{ institution?: string | null; degree?: string | null; year?: number | string | null }> | null
    certifications?: Array<{ name?: string | null; issuer?: string | null; year?: number | string | null }> | null
    projects?: Array<{ name?: string | null; description?: string | null; tech?: string | string[] | null }> | null
    preferences?: {
      work_mode?: string | null
      work_mode_flexibility?: string | null
      relocation?: boolean | string | null
      salary_annual_eur?: string | null
    } | null
    sector_details?: Record<string, string | number | boolean | string[] | null> | null
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
  // ready = il flag che l'assistente crea quando il profilo è completo
  // abbastanza per la dashboard. Unico gate: non c'è fallback client-side.
  const [profileReady, setProfileReady] = useState(false)
  // Riassunti discorsivi (MD) scritti dall'assistente: about, preferences,
  // goals, strengths. Complementari al YAML, mostrati sotto il profilo.
  const [summaries, setSummaries] = useState<Array<{ id: string; title: string; content: string; updatedAt: number }>>([])
  // Documenti originali del candidato archiviati dall'assistente (CV,
  // lettere, certificati). Servono come fallback per gli scrittori CV +
  // trasparenza lato utente ("ecco cosa ho preso in carico").
  const [sources, setSources] = useState<Array<{ name: string; size: number; ext: string; updatedAt: number }>>([])

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) return
      const data = await res.json() as { profile: Profile; ready?: boolean }
      setProfile(data.profile ?? null)
      setProfileReady(Boolean(data.ready))
    } catch { /* noop */ }
  }, [])

  const fetchSummaries = useCallback(async () => {
    try {
      const res = await fetch('/api/profile/summaries')
      if (!res.ok) return
      const data = await res.json() as { summaries?: Array<{ id: string; title: string; content: string; updatedAt: number }> }
      setSummaries(data.summaries ?? [])
    } catch { /* noop */ }
  }, [])

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/profile/sources')
      if (!res.ok) return
      const data = await res.json() as { sources?: Array<{ name: string; size: number; ext: string; updatedAt: number }> }
      setSources(data.sources ?? [])
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
      // Formato compatto: solo il marcatore + i path. Le istruzioni su cosa
      // fare con gli allegati vivono nel system prompt dell'assistente
      // (agents/assistente/assistente.md), non vanno ripetute a ogni turno.
      // Il frontend riconosce [FILE ALLEGATI] e rende i path come chip.
      const list = filePaths.join('\n')
      fullText = fullText
        ? `${fullText}\n\n[FILE ALLEGATI]\n${list}`
        : `[FILE ALLEGATI]\n${list}`
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
    fetchSummaries()
    fetchSources()
    const profileId   = setInterval(fetchProfile, 2500)
    const statusId    = setInterval(fetchStatus, 5000)
    const chatId      = setInterval(fetchChat, 3000)
    const summariesId = setInterval(fetchSummaries, 5000)
    const sourcesId   = setInterval(fetchSources, 5000)
    return () => {
      clearInterval(profileId)
      clearInterval(statusId)
      clearInterval(chatId)
      clearInterval(summariesId)
      clearInterval(sourcesId)
    }
  }, [fetchProfile, fetchStatus, fetchChat, fetchSummaries, fetchSources])

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
  // Il bottone è sbloccato SOLO dall'assistente (crea ~/.jht/profile/ready.flag).
  // Nessuna euristica qui: l'agente sa meglio del frontend quando il profilo
  // è davvero pronto, e può re-bloccare rimuovendo il file se serve.
  const canProceed = profileReady

  // Altezza divisa per --zoom: la body ha zoom globale, ma `vh` in
  // Chromium è calcolato sul viewport non zoomato → senza la divisione
  // il container trabocca di --zoom volte. Niente -4rem: su /onboarding
  // la navbar è nascosta (FULLSCREEN_FLOWS).
  return (
    <div className="flex flex-col max-w-7xl mx-auto px-5 py-5" style={{ height: 'calc(100vh / var(--zoom))', animation: 'fade-in 0.35s ease both' }}>

      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">
          Configura il tuo <span className="text-[var(--color-green)]">profilo</span>
        </h1>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
          Costruisci il tuo profilo con l&apos;aiuto dell&apos;assistente a destra. Man mano che vi confrontate, il pannello a sinistra si aggiorna automaticamente.
        </p>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">

        {/* ── Sinistra: Live profile ──────────────────────────────────── */}
        <aside className="w-[46%] flex flex-col min-w-0">
          <div className="flex-1 rounded-lg overflow-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
              <Avatar role="user" size={32} />
              <span className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
                configurazione profilo
              </span>
            </div>
            <ProfileLive profile={profile} summaries={summaries} sources={sources} />
          </div>

          <button
            disabled={!canProceed}
            onClick={() => { if (canProceed) router.push('/onboarding/cloud') }}
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
              : 'In attesa dell’assistente…'}
          </button>
        </aside>

        {/* ── Destra: Chat assistente ─────────────────────────────────── */}
        <section className="flex-1 flex flex-col min-w-0 rounded-lg overflow-hidden"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>

          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <Avatar role="assistant" size={32} />
            <span className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
              assistente
            </span>
            {startError && !speechError && (
              <span className="text-[9px] text-[var(--color-red)] truncate max-w-[260px] ml-auto">
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
                <div className="text-3xl mb-3 opacity-30">👨‍💼</div>
                <p className="text-[11px] text-[var(--color-dim)] max-w-xs leading-relaxed mb-4">
                  Avvio dell&apos;assistente in corso…
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
            {/* 3 puntini "sto lavorando". Mostrati quando:
                 (a) l'ultima bubble è dell'utente (aspetto il primo reply), oppure
                 (b) l'ultima bubble dell'assistente è un checkpoint intermedio (done=false).
                 Safety stale: dopo 10 minuti di silenzio con done=false consideriamo
                 l'agente bloccato/crashato e spegniamo i puntini.
                 I puntini escono sempre "dalla testa dell'assistente": stesso layout
                 avatar+bubble di ChatBubble, così visivamente l'animazione è ancorata
                 al personaggio invece che fluttuare a vuoto. */}
            {(() => {
              if (messages.length === 0) return null
              const last = messages[messages.length - 1]
              const waitingFirstReply = last.role === 'user'
              const inProgress = last.role === 'assistant' && last.done === false
              const stale = Date.now() / 1000 - last.ts > 600
              if (!waitingFirstReply && (!inProgress || stale)) return null
              return (
                // items-center + tail centrato verticalmente: la bubble dei 3
                // puntini è più bassa del testo normale, quindi se lasciassimo
                // items-start con tail a top-2.5 il tail finirebbe nella parte
                // alta mentre l'avatar rimane al centro → disallineato.
                <div className="flex mb-3 justify-start items-center gap-2">
                  <Avatar role="assistant" />
                  <div className="relative px-3 py-2 rounded-lg" style={{ background: '#1c2333' }}>
                    <span
                      aria-hidden
                      className="absolute top-1/2 -left-1.5 w-3 h-3 rotate-45 -translate-y-1/2"
                      style={{ background: '#1c2333' }}
                    />
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.2s infinite' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" style={{ animation: 'pulse-dot 1.4s ease-in-out 0.4s infinite' }} />
                    </span>
                  </div>
                </div>
              )
            })()}
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

          {/* Input — zero effetti al focus: niente ring, niente bordi
               colorati. Solo un schiarimento quasi impercettibile del
               background quando il cursore è dentro, giusto per segnalare
               "stai scrivendo qui" senza invadenza.
               NB: background via classe (bg-[var(--color-deep)]) e non
               inline style, altrimenti focus-within:bg-... non si applica
               (lo style inline ha sempre precedenza sulla classe). */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleSend() }}
            className="flex items-center border-t border-[var(--color-border)] outline-none bg-[var(--color-deep)] focus-within:bg-[var(--color-row)] transition-colors"
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
              // outline:none inline per battere la regola globale
              // `:focus-visible { outline: 2px solid green }` in globals.css
              // senza toglierla al resto dell'app (serve a11y tastiera).
              className="flex-1 px-2 py-3 text-[12px] bg-transparent outline-none"
              style={{ color: 'var(--color-bright)', outline: 'none' }}
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

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'
  const { text, attachments } = extractAttachments(msg.text)
  const bubbleBg = isUser ? 'var(--color-green)' : '#1c2333'

  const bubble = (
    <div
      className="relative max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed flex flex-col gap-2"
      style={{
        background: bubbleBg,
        color: isUser ? '#000' : 'var(--color-bright)',
        wordBreak: 'break-word',
      }}
    >
      {/* Tail del fumetto: triangolino che punta verso l'avatar.
          Per l'assistente: a sinistra. Per l'utente: a destra. */}
      <span
        aria-hidden
        className={`absolute top-2.5 w-3 h-3 rotate-45 ${isUser ? '-right-1.5' : '-left-1.5'}`}
        style={{ background: bubbleBg }}
      />
      {text && <MiniMarkdown text={text} />}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((name, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px]"
              style={{
                background: isUser ? 'rgba(0,0,0,0.12)' : 'var(--color-card)',
                border: `1px solid ${isUser ? 'rgba(0,0,0,0.15)' : 'var(--color-border)'}`,
              }}
            >
              <span>📎</span>
              <span className="font-mono">{name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )

  if (isUser) {
    return (
      <div className="flex mb-3 justify-end items-start gap-2">
        {bubble}
        <Avatar role="user" />
      </div>
    )
  }

  return (
    <div className="flex mb-3 justify-start items-start gap-2">
      <Avatar role="assistant" />
      {bubble}
    </div>
  )
}

// Avatar condiviso tra ChatBubble e indicatore "sta scrivendo".
// Emoji user: 👤 (sagoma busto) — placeholder finché non c'è un avatar
// configurato per il profilo utente.
function Avatar({ role, size = 28 }: { role: 'user' | 'assistant'; size?: number }) {
  const isUser = role === 'user'
  return (
    <div
      className="flex items-center justify-center shrink-0 rounded-full select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.57),
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
      }}
      aria-label={isUser ? 'tu' : 'assistente'}
    >
      {isUser ? '👤' : '👨‍💼'}
    </div>
  )
}

function extractAttachments(raw: string): { text: string; attachments: string[] } {
  const m = /\n*\[FILE ALLEGATI\]\n([\s\S]*?)$/i.exec(raw)
  if (!m) return { text: raw, attachments: [] }
  const text = raw.slice(0, m.index).trim()
  const paths = m[1]
    .split('\n')
    .map(l => l.trim().replace(/^📎\s*/, ''))
    .filter(Boolean)
  // Mostra solo il basename: "cv-developer-IT.pdf" invece del path completo
  const names = paths.map(p => p.split('/').filter(Boolean).pop() ?? p)
  return { text, attachments: names }
}

// Renderer markdown minimale: bold (**x**), italic (*x*), inline code (`x`),
// link [t](u), liste numerate (\d+\.) e puntate (- / *), paragrafi separati
// da riga vuota. Niente dipendenze esterne — abbastanza per i messaggi
// dell'assistente, che non produce HTML né blocchi di codice lunghi.
function MiniMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        const isOrdered = lines.every(l => /^\s*\d+\.\s+/.test(l))
        const isBulleted = lines.every(l => /^\s*[-*]\s+/.test(l))
        if (isOrdered && lines.length > 1) {
          return (
            <ol key={bi} className="list-decimal list-outside pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
              ))}
            </ol>
          )
        }
        if (isBulleted && lines.length > 1) {
          return (
            <ul key={bi} className="list-disc list-outside pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const regex = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^\)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = regex.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(<code key={key++} className="px-1 rounded text-[11px]" style={{ background: 'var(--color-row)', color: 'var(--color-green)' }}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^\)]+)\)$/.exec(tok)
      if (mm) out.push(<a key={key++} href={mm[2]} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--color-green)' }}>{mm[1]}</a>)
      else out.push(tok)
    } else if (tok.startsWith('*')) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

// Esempi placeholder mix di settori — cuochi, infermieri, avvocati, designer,
// insegnanti, muratori, ecc. Uno casuale è scelto al mount così ogni avvio
// l'utente vede un esempio diverso: niente bias verso il tech. Tutti i pool
// hanno la stessa lunghezza semantica (indice condiviso = stesso settore).
const PLACEHOLDER_ROLES = [
  'Es. Sous chef',
  'Es. Infermiere di reparto',
  'Es. Avvocato civilista',
  'Es. Graphic designer',
  'Es. Insegnante di scuola primaria',
  'Es. Project manager',
  'Es. Estetista',
  'Es. Elettricista specializzato',
  'Es. Addetto vendita',
  'Es. Full Stack Developer',
]
const PLACEHOLDER_LOCATIONS = [
  'Es. Bologna, IT',
  'Es. Napoli, IT',
  'Es. Palermo, IT',
  'Es. Torino, IT',
  'Es. Verona, IT',
  'Es. Firenze, IT',
  'Es. Bari, IT',
  'Es. Genova, IT',
  'Es. Cagliari, IT',
  'Es. Milano, IT',
]
const PLACEHOLDER_EXPERIENCE = [
  'Es. Capopartita · Ristorante Da Mario · 4 anni',
  'Es. Infermiere · Ospedale San Raffaele · 6 anni',
  'Es. Avvocato associato · Studio Rossi & C. · 3 anni',
  'Es. Art director · Agenzia Pop · 5 anni',
  'Es. Insegnante di sostegno · IC Verdi · 7 anni',
  'Es. Project manager · Acme Srl · 4 anni',
  'Es. Responsabile SPA · Hotel Terme · 3 anni',
  'Es. Elettricista · Impianti Neri · 8 anni',
  'Es. Commessa · Boutique Luna · 2 anni',
  'Es. Senior Developer · Acme · 3 anni',
]
const PLACEHOLDER_EDUCATION = [
  'Es. Diploma Istituto Alberghiero · IPSAR Milano',
  'Es. Laurea in Scienze Infermieristiche · Università di Bologna',
  'Es. Laurea magistrale in Giurisprudenza · La Sapienza',
  'Es. Diploma Accademia Belle Arti · Brera',
  'Es. Laurea in Scienze della Formazione · Università di Padova',
  'Es. Laurea in Economia · Bocconi',
  'Es. Diploma tecnico · ITIS Fermi',
  'Es. Qualifica professionale · CFP Salesiani',
  'Es. Diploma scientifico · Liceo Galilei',
  'Es. Laurea in Informatica · Università di …',
]
// Chips di competenze: array di 4 chip per settore misto. Niente doppi dev.
const PLACEHOLDER_SKILL_SETS: string[][] = [
  ['Cucina italiana', 'Pasticceria', 'Gestione magazzino', '…'],
  ['Triage', 'Assistenza post-op', 'Medicazioni', '…'],
  ['Diritto civile', 'Stesura atti', 'Udienze', '…'],
  ['Photoshop', 'Illustrazione', 'Branding', '…'],
  ['Didattica inclusiva', 'Programmazione lezioni', 'Valutazione', '…'],
  ['Team leadership', 'Budgeting', 'Public speaking', '…'],
  ['Massaggi', 'Trattamenti viso', 'Consulenza prodotto', '…'],
  ['Impianti civili', 'Quadri elettrici', 'Sicurezza CEI', '…'],
  ['Vendita assistita', 'Visual merchandising', 'Gestione cassa', '…'],
  ['React', 'Python', 'PostgreSQL', '…'],
]
// NB: non usare Math.random() all'init dello state perché SSR e client
// calcolerebbero valori diversi → hydration mismatch. La randomizzazione
// avviene dentro useEffect (vedi ProfileLive), lato client-only.
function pickIndex(): number {
  return Math.floor(Math.random() * PLACEHOLDER_ROLES.length)
}

// Formatta il campo `years` di un'esperienza. Se è un numero o stringa
// puramente numerica → "N anni". Se è già una frase ("2025 - in corso",
// "gennaio 2022 - oggi", ecc.) la mostra tale e quale senza appendere
// "anni" che porterebbe a cose tipo "2025 - in corso anni".
function formatYears(raw: number | string | null | undefined): string {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''
  return /^\d+(?:[.,]\d+)?$/.test(s) ? `${s} ${Number(s) === 1 ? 'anno' : 'anni'}` : s
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ProfileLive({ profile, summaries, sources }: {
  profile: Profile
  summaries: Array<{ id: string; title: string; content: string; updatedAt: number }>
  sources: Array<{ name: string; size: number; ext: string; updatedAt: number }>
}) {
  // Randomizzazione post-mount per evitare hydration mismatch su Math.random.
  // Server e primo render client partono da idx=0 (cucina: sous chef /
  // ristorante / alberghiero — non tech, default neutro), poi dopo il mount
  // useEffect sceglie un settore casuale. Il flip è istantaneo all'occhio.
  const [phIdx, setPhIdx] = useState(0)
  useEffect(() => { setPhIdx(pickIndex()) }, [])
  const skills = profile?.skills
    ? Object.values(profile.skills).flat().filter(Boolean)
    : []
  const langs = (profile?.languages ?? [])
    .map(l => [l.language, l.level].filter(Boolean).join(' '))
    .filter(Boolean)
  // Il reader sposta candidate.experience/education sotto positioning.*
  // (vedi profile-reader.ts). Leggi da lì, con fallback sul vecchio path
  // per retrocompatibilità con eventuali profili salvati prima del fix.
  const experience = profile?.positioning?.experience ?? profile?.candidate?.experience ?? []
  const education = profile?.positioning?.education ?? profile?.candidate?.education ?? []
  const contacts = profile?.positioning?.contacts ?? {}
  const prefs = profile?.positioning?.preferences ?? null
  const projects = profile?.positioning?.projects ?? []
  const certifications = profile?.positioning?.certifications ?? []
  // Dict aperto: ogni settore ha i suoi campi (cucina: specializzazione,
  // sanità: iscrizione_albo, edile: patentini, ecc.). Il frontend non sa
  // quali chiavi arriveranno, le mostra come lista generica key: value.
  const sectorDetails = profile?.positioning?.sector_details ?? null
  const sectorEntries: Array<[string, string]> = sectorDetails
    ? Object.entries(sectorDetails)
        .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
    : []

  return (
    <div className="px-4 py-4 flex flex-col gap-4 text-[11px]">
      <Section label="Identità" icon="👤">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" value={profile?.name} placeholder="Mario Rossi" highlight />
          <Field label="Ruolo target" value={profile?.target_role} placeholder={PLACEHOLDER_ROLES[phIdx]} highlight />
          <Field label="Località" value={profile?.location} placeholder={PLACEHOLDER_LOCATIONS[phIdx]} />
          <Field label="Anni esperienza" value={profile?.experience_years != null ? String(profile.experience_years) : null} placeholder="Es. 5" />
        </div>
      </Section>

      <Section label="Contatti" icon="📱">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" value={profile?.email ?? contacts.email ?? null} placeholder="nome@example.com" />
          <Field label="Telefono" value={contacts.phone ?? null} placeholder="+39 …" />
          {contacts.linkedin && <Field label="LinkedIn" value={contacts.linkedin} />}
          {contacts.github && <Field label="GitHub" value={contacts.github} />}
          {contacts.website && <Field label="Sito" value={contacts.website} />}
        </div>
      </Section>

      <Section label="Competenze" icon="🛠️">
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
          <PlaceholderChips items={PLACEHOLDER_SKILL_SETS[phIdx]} />
        )}
      </Section>

      <Section label="Lingue" icon="🌍">
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

      <Section label="Esperienza" icon="💼">
        {experience.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {experience.slice(0, 4).map((e, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                <span className="font-semibold">{e.role ?? '—'}</span>
                {e.company ? <span className="text-[var(--color-muted)]"> · {e.company}</span> : null}
                {e.years ? <span className="text-[var(--color-dim)]"> · {formatYears(e.years)}</span> : null}
              </li>
            ))}
            {experience.length > 4 && (
              <li className="text-[9.5px] text-[var(--color-dim)]">+{experience.length - 4} altre</li>
            )}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">{PLACEHOLDER_EXPERIENCE[phIdx]}</div>
        )}
      </Section>

      {sectorEntries.length > 0 && (
        <Section label="Dettagli del settore" icon="🏢">
          <ul className="flex flex-col gap-1">
            {sectorEntries.map(([k, v]) => (
              <li key={k} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px] mr-1.5">{k.replace(/_/g, ' ')}</span>
                {v}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {projects.length > 0 && (
        <Section label="Progetti" icon="🚀">
          <ul className="flex flex-col gap-1.5">
            {projects.slice(0, 4).map((p, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                <span className="font-semibold">{p.name ?? '—'}</span>
                {p.description ? (
                  <div className="text-[10px] text-[var(--color-muted)] leading-snug mt-0.5">
                    {String(p.description).split('\n')[0].slice(0, 180)}
                  </div>
                ) : null}
              </li>
            ))}
            {projects.length > 4 && (
              <li className="text-[9.5px] text-[var(--color-dim)]">+{projects.length - 4} altri</li>
            )}
          </ul>
        </Section>
      )}

      {certifications.length > 0 && (
        <Section label="Certificazioni" icon="🏅">
          <ul className="flex flex-col gap-0.5">
            {certifications.slice(0, 5).map((c, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                {c.name ?? '—'}
                {c.issuer ? <span className="text-[var(--color-muted)]"> · {c.issuer}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Titoli di studio" icon="🎓">
        {education.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {education.slice(0, 3).map((e, i) => (
              <li key={i} className="text-[10.5px] text-[var(--color-bright)] leading-snug">
                {e.degree ?? '—'}{e.institution ? <span className="text-[var(--color-muted)]"> · {e.institution}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">{PLACEHOLDER_EDUCATION[phIdx]}</div>
        )}
      </Section>

      {summaries.length > 0 && (
        <div className="flex flex-col gap-3 pt-1 border-t border-[var(--color-border)] mt-1">
          {summaries.map(s => (
            <Section key={s.id} label={s.title} icon={iconForSummary(s.title)}>
              <div className="text-[11px] leading-relaxed text-[var(--color-bright)]">
                <MiniMarkdown text={s.content} />
              </div>
            </Section>
          ))}
        </div>
      )}

      {/* I file in profile/sources/ NON sono mostrati qui: sono un dettaglio
           interno di archiviazione, non informazione del profilo. Gli
           scrittori CV a valle li leggono via /api/profile/sources — al
           resto della UI l'utente non deve pensarci. */}

      <Section label="Preferenze di lavoro" icon="🎯">
        {prefs ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-3">
              {prefs.work_mode && (
                <Field label="Modalità" value={prefs.work_mode} />
              )}
              {prefs.relocation != null && (
                <Field
                  label="Trasferimento"
                  value={typeof prefs.relocation === 'boolean'
                    ? (prefs.relocation ? 'disponibile' : 'non disponibile')
                    : String(prefs.relocation)}
                />
              )}
              {prefs.salary_annual_eur && (
                <Field label="Retribuzione" value={prefs.salary_annual_eur} />
              )}
            </div>
            {prefs.work_mode_flexibility && (
              <div className="text-[10px] text-[var(--color-muted)] italic leading-snug">
                {prefs.work_mode_flexibility}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">Es. Remoto · Disponibile al trasferimento · 30–35k</div>
        )}
      </Section>
    </div>
  )
}

function Section({ label, icon, children }: { label: string; icon?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-1.5 flex items-center gap-1.5">
        {icon && <span className="text-[13px] leading-none">{icon}</span>}
        <span>{label}</span>
      </div>
      {children}
    </div>
  )
}

// Icona euristica per i summary dinamici (about, preferences, goals, …).
// I titoli arrivano dall'assistente, quindi il match è fuzzy sulla keyword.
function iconForSummary(title: string): string {
  const t = title.toLowerCase()
  if (/preferenz|desider/.test(t)) return '⚙️'
  if (/obiett|goal|aspirazion/.test(t)) return '🎯'
  if (/forza|strength|punti\s+forti/.test(t)) return '⭐'
  if (/chi\s+sono|about|di\s+me|profilo/.test(t)) return '👋'
  if (/stor|percorso/.test(t)) return '🧭'
  return '📝'
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
