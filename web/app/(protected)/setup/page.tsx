'use client'

import { useState, useEffect } from 'react'
import { Card, NavButtons } from './ui'

const STEPS = ['prereq', 'model', 'apikey', 'health'] as const
type Step = (typeof STEPS)[number]
const LABELS: Record<Step, string> = { prereq: 'Prerequisiti', model: 'Modello', apikey: 'API Key', health: 'Health' }
const PROVIDERS = [{ v: 'claude', l: 'Anthropic Claude' }, { v: 'openai', l: 'OpenAI' }, { v: 'minimax', l: 'MiniMax' }]
const MODELS: Record<string, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini'], minimax: ['abab6.5s-chat'],
}

interface Check { label: string; ok: boolean; hint?: string }
interface FormState { provider: string; model: string; apiKey: string }

export default function SetupPage() {
  const [step, setStep] = useState<Step>('prereq')
  const [form, setForm] = useState<FormState>({ provider: 'claude', model: '', apiKey: '' })
  const [checks, setChecks] = useState<Check[]>([])
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [healthMsg, setHealthMsg] = useState('')

  const idx  = STEPS.indexOf(step)
  const next = () => setStep(STEPS[idx + 1])
  const back = () => setStep(STEPS[idx - 1])
  const set  = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => {
    if (step !== 'prereq') return
    setLoading(true)
    ;(async () => {
      const items: Check[] = [{ label: 'Browser moderno', ok: true }]
      try {
        const r = await fetch('/api/setup')
        const d = await r.json()
        items.push({ label: 'API server raggiungibile', ok: r.ok })
        items.push({ label: 'Config ~/.jht/jht.config.json', ok: d.exists, hint: d.exists ? undefined : 'Verrà creata al completamento' })
      } catch { items.push({ label: 'API server raggiungibile', ok: false, hint: 'Verifica che Next.js sia avviato' }) }
      setChecks(items); setLoading(false)
    })()
  }, [step])

  const save = async () => {
    setHealth('loading')
    try {
      const r = await fetch('/api/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: form.provider,
          providers: { [form.provider]: { auth_method: 'api_key', api_key: form.apiKey, model: form.model || MODELS[form.provider]?.[0] } },
        }),
      })
      const d = await r.json()
      if (r.ok) { setHealth('ok'); setHealthMsg('Configurazione salvata.') }
      else { setHealth('error'); setHealthMsg(d.error || 'Errore salvataggio') }
    } catch { setHealth('error'); setHealthMsg('Errore di rete') }
  }

  const inp = 'w-full px-3 py-2 rounded text-[12px] bg-[var(--color-card)] border border-[var(--color-border)] outline-none focus:border-[var(--color-green)] transition-colors'

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg" style={{ animation: 'fade-in 0.4s ease both' }}>
        <div className="mb-8 text-center">
          <div className="inline-flex items-center mb-4">
            <span className="text-[9px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--color-green)' }}>setup</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight leading-none mb-2" style={{ color: 'var(--color-white)' }}>
            Job Hunter<br /><span style={{ color: 'var(--color-green)' }}>Team</span>
          </h1>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-8 flex-wrap">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{ background: i <= idx ? 'var(--color-green)' : 'var(--color-border)', color: i <= idx ? '#000' : 'var(--color-dim)' }}>
                {i + 1}
              </div>
              <span className="text-[9px] tracking-widest uppercase hidden sm:inline"
                style={{ color: i === idx ? 'var(--color-bright)' : 'var(--color-dim)' }}>
                {LABELS[s]}
              </span>
              {i < STEPS.length - 1 && <span className="text-[var(--color-border)] mx-1">›</span>}
            </div>
          ))}
        </div>

        {step === 'prereq' && (
          <Card title="Prerequisiti" sub="Verifica automatica ambiente">
            {loading
              ? <p className="text-[11px] text-center py-4" role="status" aria-live="polite" style={{ color: 'var(--color-muted)' }}>Controllo in corso…</p>
              : checks.map((c, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span style={{ color: c.ok ? 'var(--color-green)' : 'var(--color-red)', fontSize: 13 }}>{c.ok ? '✓' : '✗'}</span>
                  <div>
                    <p className="text-[12px]" style={{ color: 'var(--color-bright)' }}>{c.label}</p>
                    {c.hint && <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{c.hint}</p>}
                  </div>
                </div>
              ))}
            <NavButtons onNext={next} disabled={loading} />
          </Card>
        )}

        {step === 'model' && (
          <Card title="Modello AI" sub="Provider e modello LLM">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>Provider</label>
              <select value={form.provider} onChange={e => set({ provider: e.target.value, model: '' })} aria-label="Provider AI"
                className={inp} style={{ color: 'var(--color-bright)', cursor: 'pointer' }}>
                {PROVIDERS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>Modello</label>
              <select value={form.model} onChange={e => set({ model: e.target.value })} aria-label="Modello AI"
                className={inp} style={{ color: 'var(--color-bright)', cursor: 'pointer' }}>
                <option value="">— automatico —</option>
                {(MODELS[form.provider] ?? []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <NavButtons onBack={back} onNext={next} />
          </Card>
        )}

        {step === 'apikey' && (
          <Card title="API Key" sub={`Chiave per ${form.provider}`}>
            <div className="flex flex-col gap-1">
              <label htmlFor="setup-apikey" className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-muted)' }}>Chiave API</label>
              <input id="setup-apikey" type="password" value={form.apiKey} placeholder="sk-…" onChange={e => set({ apiKey: e.target.value })}
                className={inp} style={{ color: 'var(--color-bright)' }} autoComplete="off" />
              <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>Salvata in ~/.jht/jht.config.json</p>
            </div>
            <NavButtons onBack={back} onNext={() => { next(); save() }} disabled={!form.apiKey.trim()} nextLabel="Salva e verifica" />
          </Card>
        )}

        {step === 'health' && (
          <Card title="Health Check" sub="Verifica salvataggio configurazione">
            <div className="flex flex-col items-center gap-3 py-4">
              {health === 'loading' && (
                <>
                  <div className="w-8 h-8 rounded-full border-2 animate-spin" aria-hidden="true"
                    style={{ borderColor: 'var(--color-green)', borderTopColor: 'transparent' }} />
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Salvataggio in corso…</p>
                </>
              )}
              {health === 'ok' && (
                <>
                  <span className="text-3xl" aria-hidden="true" style={{ color: 'var(--color-green)' }}>✓</span>
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--color-green)' }}>{healthMsg}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>Provider: {form.provider} · ~/.jht</p>
                </>
              )}
              {health === 'error' && (
                <>
                  <span className="text-2xl" style={{ color: 'var(--color-yellow)' }}>!</span>
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--color-yellow)' }}>
                    {healthMsg.includes('ENOENT') || healthMsg.includes('mkdir') || healthMsg.includes('no such file')
                      ? 'Questa funzione richiede il server locale'
                      : healthMsg || 'Configurazione non salvata'}
                  </p>
                  <p className="text-[10px] leading-relaxed text-center" style={{ color: 'var(--color-muted)' }}>
                    Il salvataggio su disco richiede l&apos;app in esecuzione sul tuo computer.
                    Puoi comunque proseguire alla dashboard.
                  </p>
                  <button onClick={() => save()} className="px-4 py-1.5 rounded text-[11px] cursor-pointer"
                    style={{ background: 'var(--color-border)', color: 'var(--color-bright)' }}>Riprova</button>
                </>
              )}
            </div>
            <NavButtons onBack={back} onNext={() => { window.location.href = '/dashboard' }}
              nextLabel="Vai alla dashboard" disabled={health === 'loading'} />
          </Card>
        )}

        <p className="mt-6 text-center text-[9px]" style={{ color: 'var(--color-dim)' }}>v0.1.0-alpha · Job Hunter Team</p>
      </div>
    </main>
  )
}
