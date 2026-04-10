'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Mode = 'choose' | 'ai' | 'manual'
type AiStage = 'idle' | 'uploading' | 'extracting' | 'preview' | 'saving' | 'error'

type ExtractedProfile = {
  name?: string | null
  email?: string | null
  location?: string | null
  target_role?: string | null
  experience_years?: number | null
  has_degree?: boolean
  seniority_target?: 'junior' | 'mid' | 'senior' | null
  skills?: { primary?: string[]; secondary?: string[] } | Record<string, string[]>
  languages?: Array<{ language?: string; level?: string }>
  job_titles?: string[]
  salary_target?: { currency?: string; italy_min?: number; italy_max?: number } | null
  positioning?: {
    contacts?: { email?: string; phone?: string; linkedin?: string; github?: string; website?: string }
    experience?: Array<{ company?: string; role?: string; years?: string; summary?: string }>
    education?: Array<{ institution?: string; degree?: string; year?: string }>
    strengths?: string[]
    free_notes?: string
  }
}

export default function OnboardingPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('choose')
  const [aiStage, setAiStage] = useState<AiStage>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ExtractedProfile | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const extractFromPdf = useCallback(async (file: File) => {
    setAiError(null)
    setFileName(file.name)
    setAiStage('uploading')
    try {
      const fd = new FormData()
      fd.append('file', file)
      setAiStage('extracting')
      const res = await fetch('/api/profile/extract-cv', { method: 'POST', body: fd })
      const json = await res.json().catch(() => null) as { ok?: boolean; profile?: ExtractedProfile; provider?: string; error?: string; code?: string } | null
      if (!res.ok || !json?.ok || !json.profile) {
        const msg = json?.error ?? `estrazione fallita (HTTP ${res.status})`
        setAiError(msg)
        setAiStage('error')
        return
      }
      setProfile(json.profile)
      setProvider(json.provider ?? null)
      setAiStage('preview')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'errore di rete')
      setAiStage('error')
    }
  }, [])

  const confirmProfile = useCallback(async () => {
    if (!profile) return
    setAiStage('saving')
    try {
      const res = await fetch('/api/profile-assistant/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, profile }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setAiError(j?.error ?? `salvataggio fallito (HTTP ${res.status})`)
        setAiStage('error')
        return
      }
      router.push('/dashboard')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'errore di rete')
      setAiStage('error')
    }
  }, [profile, router])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void extractFromPdf(file)
  }, [extractFromPdf])

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void extractFromPdf(file)
  }, [extractFromPdf])

  return (
    <div className="max-w-2xl mx-auto py-10 px-5" style={{ animation: 'fade-in 0.35s ease both' }}>

      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mb-2">
          Configuriamo il tuo <span className="text-[var(--color-green)]">profilo</span>
        </h1>
        <p className="text-[11px] text-[var(--color-muted)] max-w-md mx-auto">
          Scegli come vuoi iniziare. Puoi sempre passare da una modalità all&apos;altra.
        </p>
      </div>

      {mode === 'choose' && (
        <ChooseMode onAi={() => setMode('ai')} onManual={() => setMode('manual')} />
      )}

      {mode === 'ai' && (
        <AiFlow
          stage={aiStage}
          error={aiError}
          fileName={fileName}
          profile={profile}
          provider={provider}
          fileInputRef={fileInputRef}
          onDrop={onDrop}
          onSelect={onSelect}
          onOpenPicker={() => fileInputRef.current?.click()}
          onRetry={() => { setAiStage('idle'); setAiError(null); setProfile(null); setFileName(null) }}
          onConfirm={confirmProfile}
          onManual={() => setMode('manual')}
          onBack={() => setMode('choose')}
        />
      )}

      {mode === 'manual' && (
        <ManualFlow onBackToChoose={() => setMode('choose')} onSwitchToAi={() => setMode('ai')} />
      )}
    </div>
  )
}

// ── Choose mode ────────────────────────────────────────────────────────────

function ChooseMode({ onAi, onManual }: { onAi: () => void; onManual: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onAi}
        className="w-full text-left p-5 rounded-lg transition-all cursor-pointer hover:border-[var(--color-green)]"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-green)', color: '#000', fontSize: 18 }}>
            AI
          </div>
          <div className="flex-1">
            <h2 className="text-[13px] font-bold text-[var(--color-white)] mb-1">Carica il tuo CV (consigliato)</h2>
            <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
              Trascina un PDF del tuo CV: il provider AI che hai già configurato (Claude, GPT, Kimi…) estrarrà automaticamente nome, ruolo, skills ed esperienze. Usa la tua API key o il tuo abbonamento — nessun token è a nostro carico.
            </p>
          </div>
        </div>
      </button>

      <button
        onClick={onManual}
        className="w-full text-left p-5 rounded-lg transition-all cursor-pointer hover:border-[var(--color-muted)]"
        style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', fontSize: 16 }}>
            ✎
          </div>
          <div className="flex-1">
            <h2 className="text-[13px] font-bold text-[var(--color-white)] mb-1">Compila a mano</h2>
            <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
              Wizard passo-passo. In ogni momento puoi passare al caricamento del CV se cambi idea.
            </p>
          </div>
        </div>
      </button>
    </div>
  )
}

// ── AI flow ────────────────────────────────────────────────────────────────

type AiFlowProps = {
  stage: AiStage
  error: string | null
  fileName: string | null
  profile: ExtractedProfile | null
  provider: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onDrop: (e: React.DragEvent) => void
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenPicker: () => void
  onRetry: () => void
  onConfirm: () => void
  onManual: () => void
  onBack: () => void
}

function AiFlow(p: AiFlowProps) {
  return (
    <div>
      <button onClick={p.onBack} className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] mb-4 cursor-pointer transition-colors">
        ← Torna alle opzioni
      </button>

      {(p.stage === 'idle' || p.stage === 'error') && (
        <>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={p.onDrop}
            onClick={p.onOpenPicker}
            className="p-10 rounded-lg text-center cursor-pointer transition-colors hover:border-[var(--color-green)]"
            style={{ background: 'var(--color-deep)', border: '2px dashed var(--color-border)' }}
          >
            <div className="text-[32px] mb-3 opacity-40">⬆</div>
            <p className="text-[12px] text-[var(--color-bright)] font-medium mb-1">Trascina qui il tuo CV</p>
            <p className="text-[10px] text-[var(--color-dim)]">oppure clicca per sceglierlo · PDF · max 10 MB</p>
            <input
              ref={p.fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={p.onSelect}
            />
          </div>

          {p.error && (
            <div className="mt-4 px-4 py-3 rounded text-[10px]" style={{ background: 'var(--color-row)', border: '1px solid var(--color-red)', color: 'var(--color-red)' }}>
              <p className="font-bold mb-1">Estrazione non riuscita</p>
              <p className="text-[var(--color-bright)]">{p.error}</p>
            </div>
          )}

          <div className="mt-6 text-center">
            <button onClick={p.onManual} className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] cursor-pointer transition-colors underline-offset-2 hover:underline">
              Preferisco compilare a mano
            </button>
          </div>
        </>
      )}

      {(p.stage === 'uploading' || p.stage === 'extracting' || p.stage === 'saving') && (
        <div className="py-16 text-center">
          <div className="w-8 h-8 mx-auto mb-4 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-green)] animate-spin" />
          <p className="text-[11px] text-[var(--color-bright)] font-medium">
            {p.stage === 'uploading' && 'Caricamento del CV…'}
            {p.stage === 'extracting' && 'Sto leggendo il CV con l\'agente AI…'}
            {p.stage === 'saving' && 'Salvataggio del profilo…'}
          </p>
          {p.fileName && <p className="text-[9px] text-[var(--color-dim)] mt-1">{p.fileName}</p>}
        </div>
      )}

      {p.stage === 'preview' && p.profile && (
        <ProfilePreview profile={p.profile} provider={p.provider} onConfirm={p.onConfirm} onRetry={p.onRetry} />
      )}
    </div>
  )
}

function ProfilePreview({ profile, provider, onConfirm, onRetry }: { profile: ExtractedProfile; provider: string | null; onConfirm: () => void; onRetry: () => void }) {
  const skills = (() => {
    const s = profile.skills
    if (!s) return [] as string[]
    if (Array.isArray((s as { primary?: unknown }).primary)) {
      return [...((s as { primary?: string[] }).primary ?? []), ...((s as { secondary?: string[] }).secondary ?? [])]
    }
    return Object.values(s as Record<string, string[]>).flat()
  })()
  const langs = profile.languages?.map(l => [l.language, l.level].filter(Boolean).join(' ')).filter(Boolean) ?? []

  const row = (label: string, value?: string | null | number) => (
    <div className="flex justify-between items-start gap-3 px-3 py-2 rounded" style={{ background: 'var(--color-row)' }}>
      <span className="text-[9px] tracking-widest text-[var(--color-dim)] uppercase">{label}</span>
      <span className="text-[10px] text-[var(--color-bright)] text-right font-medium truncate max-w-[65%]">{value ?? '—'}</span>
    </div>
  )

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" />
        <p className="text-[10px] text-[var(--color-green)] font-bold tracking-widest uppercase">
          Estratto da {provider ?? 'AI'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        {row('Nome', profile.name)}
        {row('Email', profile.email ?? profile.positioning?.contacts?.email)}
        {row('Località', profile.location)}
        {row('Ruolo target', profile.target_role)}
        {row('Anni esperienza', profile.experience_years)}
        {row('Seniority', profile.seniority_target)}
        {skills.length > 0 && row('Skills', skills.slice(0, 8).join(', ') + (skills.length > 8 ? `  +${skills.length - 8}` : ''))}
        {langs.length > 0 && row('Lingue', langs.join(' · '))}
      </div>

      <p className="text-[9px] text-[var(--color-dim)] mb-4 leading-relaxed">
        Controlla i dati estratti. Se qualcosa non va puoi ricaricare un altro CV o rifinirlo dopo dal profilo.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 px-4 py-2.5 rounded-lg text-[11px] font-bold cursor-pointer transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-green)', color: '#000' }}
        >
          Conferma e continua
        </button>
        <button
          onClick={onRetry}
          className="px-4 py-2.5 rounded-lg text-[11px] font-bold cursor-pointer"
          style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        >
          Ricarica altro CV
        </button>
      </div>
    </div>
  )
}

// ── Manual flow ────────────────────────────────────────────────────────────

function ManualFlow({ onBackToChoose, onSwitchToAi }: { onBackToChoose: () => void; onSwitchToAi: () => void }) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '', email: '', location: '', target_role: '',
    experience_years: '', seniority_target: 'mid' as 'junior' | 'mid' | 'senior',
    skills: '', languages: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = form.name.trim().length > 0 && form.target_role.trim().length > 0

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const profile = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        location: form.location.trim() || null,
        target_role: form.target_role.trim(),
        experience_years: form.experience_years ? Number(form.experience_years) : 0,
        has_degree: false,
        seniority_target: form.seniority_target,
        skills: { primary: form.skills.split(',').map(s => s.trim()).filter(Boolean) },
        languages: form.languages
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => {
            const [language, level] = s.split(/\s+/)
            return { language, level: level ?? '' }
          }),
        job_titles: [form.target_role.trim()],
        positioning: {
          contacts: { email: form.email.trim() || undefined },
          experience: [],
          education: [],
          strengths: [],
          free_notes: '',
        },
      }
      const res = await fetch('/api/profile-assistant/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, profile }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(j?.error ?? `salvataggio fallito (HTTP ${res.status})`)
      }
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
      setSaving(false)
    }
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-bright)', border: '1px solid var(--color-border)' } as const
  const label = (s: string) => <label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{s}</label>

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <button onClick={onBackToChoose} className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] cursor-pointer transition-colors">
          ← Opzioni
        </button>
        <button
          onClick={onSwitchToAi}
          className="text-[10px] text-[var(--color-green)] hover:opacity-80 cursor-pointer transition-opacity"
        >
          ✦ Caricami il CV
        </button>
      </div>

      <div className="flex flex-col gap-3 mb-5">
        <div>
          {label('Nome completo *')}
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Mario Rossi"
            className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
            style={inputStyle}
            autoComplete="name"
          />
        </div>
        <div>
          {label('Ruolo target *')}
          <input
            value={form.target_role}
            onChange={e => setForm({ ...form, target_role: e.target.value })}
            placeholder="es. Backend Engineer"
            className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
            style={inputStyle}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {label('Email')}
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="nome@dominio.com"
              className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
              style={inputStyle}
              autoComplete="email"
            />
          </div>
          <div>
            {label('Località')}
            <input
              value={form.location}
              onChange={e => setForm({ ...form, location: e.target.value })}
              placeholder="Milano"
              className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
              style={inputStyle}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {label('Anni esperienza')}
            <input
              type="number"
              value={form.experience_years}
              onChange={e => setForm({ ...form, experience_years: e.target.value })}
              placeholder="5"
              className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
              style={inputStyle}
            />
          </div>
          <div>
            {label('Seniority')}
            <select
              value={form.seniority_target}
              onChange={e => setForm({ ...form, seniority_target: e.target.value as 'junior' | 'mid' | 'senior' })}
              className="w-full text-[11px] px-3 py-2 rounded-lg mt-1 cursor-pointer"
              style={inputStyle}
            >
              <option value="junior">junior</option>
              <option value="mid">mid</option>
              <option value="senior">senior</option>
            </select>
          </div>
        </div>
        <div>
          {label('Skills (separate da virgola)')}
          <input
            value={form.skills}
            onChange={e => setForm({ ...form, skills: e.target.value })}
            placeholder="TypeScript, React, Postgres"
            className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
            style={inputStyle}
          />
        </div>
        <div>
          {label('Lingue (es. "italiano native, english C1")')}
          <input
            value={form.languages}
            onChange={e => setForm({ ...form, languages: e.target.value })}
            placeholder="italiano native, english C1"
            className="w-full text-[11px] px-3 py-2 rounded-lg mt-1"
            style={inputStyle}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-[10px]" style={{ background: 'var(--color-row)', border: '1px solid var(--color-red)', color: 'var(--color-red)' }}>
          {error}
        </div>
      )}

      <button
        onClick={save}
        disabled={!canSave || saving}
        className="w-full px-4 py-2.5 rounded-lg text-[11px] font-bold cursor-pointer transition-opacity"
        style={{
          background: canSave && !saving ? 'var(--color-green)' : 'var(--color-row)',
          color: canSave && !saving ? '#000' : 'var(--color-dim)',
          cursor: canSave && !saving ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Salvataggio…' : 'Salva profilo e vai alla dashboard'}
      </button>
    </div>
  )
}
