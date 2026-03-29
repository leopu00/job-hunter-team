'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CandidateProfile } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  profile: CandidateProfile | null
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'Email',
  target_role: 'Ruolo target',
  location: 'Location',
  experience_years: 'Anni esperienza',
  experience_months: 'Mesi esperienza',
  has_degree: 'Laurea',
  skills: 'Skills',
  languages: 'Lingue',
  job_titles: 'Ruoli target',
  location_preferences: 'Location preferite',
  salary_target: 'Salary target',
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sì' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (typeof value[0] === 'string') return value.join(', ')
    return JSON.stringify(value)
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function ProfileAssistant({ profile }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Ciao! Sono il tuo assistente per il profilo. Posso aiutarti a compilare i campi mancanti o puoi caricare il tuo CV in PDF e lo analizzerò automaticamente.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposedChanges, setProposedChanges] = useState<Partial<CandidateProfile> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const appendAssistantMessage = useCallback((text: string) =>
    setMessages(prev => [...prev, { role: 'assistant', text }]), [])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setLoading(true)

    try {
      const res = await fetch('/api/profile-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, profile }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) {
        appendAssistantMessage(`Errore: ${data.error}`)
      } else {
        if (data.reply) appendAssistantMessage(data.reply)
        if (data.proposed_changes && Object.keys(data.proposed_changes).length > 0) {
          setProposedChanges(prev => ({ ...prev, ...data.proposed_changes }))
        }
      }
    } catch {
      appendAssistantMessage('Servizio non disponibile al momento. Riprova tra poco.')
    } finally {
      setLoading(false)
    }
  }

  const uploadCV = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') {
      appendAssistantMessage('Per favore carica un file PDF valido.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      appendAssistantMessage('File troppo grande. Massimo 10MB.')
      return
    }
    setLoading(true)
    appendAssistantMessage(`Sto analizzando "${file.name}"...`)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/profile-assistant/upload-cv', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.proposed_changes && Object.keys(data.proposed_changes).length > 0) {
        setProposedChanges(prev => ({ ...prev, ...data.proposed_changes }))
        appendAssistantMessage(
          'Ho estratto le informazioni dal CV. Controlla le modifiche proposte qui sotto e salva se sono corrette.'
        )
      } else {
        appendAssistantMessage('Ho analizzato il CV ma non ho trovato nuove informazioni da aggiungere.')
      }
    } catch {
      appendAssistantMessage('Errore nel caricamento del CV. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  const saveChanges = async () => {
    if (!proposedChanges) return
    setSaving(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSaving(false)
      appendAssistantMessage('Sessione scaduta. Ricarica la pagina.')
      return
    }

    const { error } = await supabase
      .from('candidate_profiles')
      .upsert(
        { user_id: user.id, ...proposedChanges, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )

    setSaving(false)
    if (error) {
      appendAssistantMessage(`Errore nel salvataggio: ${error.message}`)
    } else {
      setSaveSuccess(true)
      setProposedChanges(null)
      appendAssistantMessage('Modifiche salvate. Il profilo è stato aggiornato.')
      saveTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false)
        window.location.reload()
      }, 1500)
    }
  }

  const filteredChanges = proposedChanges
    ? Object.entries(proposedChanges).filter(
        ([k]) => !['user_id', 'id', 'created_at', 'updated_at'].includes(k)
      )
    : []

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--color-green)] text-[var(--color-void)] flex items-center justify-center shadow-lg hover:opacity-90 transition-all z-50 cursor-pointer border-0"
        aria-label={open ? 'Chiudi assistente' : 'Apri assistente profilo'}
        title="Assistente profilo"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 w-96 max-h-[600px] bg-[var(--color-deep)] border border-[var(--color-border)] rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
          style={{ animation: 'fade-in 0.2s ease both' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" />
              <span className="text-[11px] font-bold tracking-widest uppercase text-[var(--color-white)]">
                Assistente Profilo
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer bg-transparent border-0 p-0 flex items-center"
              aria-label="Chiudi"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[var(--color-green)]/15 text-[var(--color-bright)] border border-[var(--color-green)]/20'
                      : 'bg-[var(--color-card)] text-[var(--color-base)] border border-[var(--color-border)]'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
                  <span className="text-[11px] text-[var(--color-dim)] animate-pulse">···</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Proposed changes preview */}
          {filteredChanges.length > 0 && (
            <div className="border-t border-[var(--color-border)] flex-shrink-0">
              <div className="px-4 py-3 bg-[var(--color-green)]/5">
                <div className="text-[9px] font-bold tracking-widest uppercase text-[var(--color-green)] mb-2">
                  Modifiche proposte
                </div>
                <div className="max-h-36 overflow-y-auto space-y-0">
                  {filteredChanges.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)] last:border-0"
                    >
                      <span className="text-[9px] font-bold tracking-widest uppercase text-[var(--color-dim)] pt-0.5 w-24 flex-shrink-0">
                        {FIELD_LABELS[key] ?? key}
                      </span>
                      <span className="text-[11px] text-[var(--color-bright)] break-words">
                        {formatValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
                <button
                  onClick={saveChanges}
                  disabled={saving || saveSuccess}
                  className="flex-1 py-2 bg-[var(--color-green)] text-[var(--color-void)] text-[10px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer border-0"
                >
                  {saving ? 'Salvataggio...' : saveSuccess ? 'Salvato!' : 'Salva modifiche'}
                </button>
                <button
                  onClick={() => {
                    setProposedChanges(null)
                    setSaveSuccess(false)
                  }}
                  className="px-3 py-2 border border-[var(--color-border)] text-[10px] text-[var(--color-muted)] rounded hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer bg-transparent"
                >
                  Scarta
                </button>
              </div>
            </div>
          )}

          {/* Upload CV */}
          <div className="border-t border-[var(--color-border)] px-4 py-2 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) uploadCV(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full py-1.5 border border-dashed border-[var(--color-border)] text-[10px] text-[var(--color-dim)] rounded hover:border-[var(--color-muted)] hover:text-[var(--color-muted)] transition-colors disabled:opacity-40 cursor-pointer bg-transparent"
            >
              + Carica CV (PDF)
            </button>
          </div>

          {/* Input */}
          <div className="border-t border-[var(--color-border)] px-4 py-3 flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Scrivi un messaggio..."
              disabled={loading}
              className="flex-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px] text-[var(--color-bright)] placeholder:text-[var(--color-dim)] focus:outline-none focus:border-[var(--color-green)] transition-colors disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-3 py-1.5 bg-[var(--color-green)] text-[var(--color-void)] rounded hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer border-0 flex items-center"
              aria-label="Invia"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
