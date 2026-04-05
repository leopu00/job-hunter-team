'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const STEPS = [
  { id: 'welcome', label: 'Benvenuto' },
  { id: 'profile', label: 'Profilo' },
  { id: 'preferences', label: 'Preferenze' },
  { id: 'channels', label: 'Canali' },
  { id: 'summary', label: 'Riepilogo' },
]

function Stepper({ current, completed }: { current: number; completed: string[] }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((s, i) => {
        const done = completed.includes(s.id), active = i === current
        return (
          <div key={s.id} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{ background: done ? 'var(--color-green)' : active ? 'var(--color-white)' : 'var(--color-row)', color: done || active ? '#000' : 'var(--color-dim)' }}>
                {done ? '✓' : i + 1}
              </div>
              <span className="text-[8px] mt-1" style={{ color: active ? 'var(--color-white)' : 'var(--color-dim)' }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 mt-[-12px]" style={{ background: done ? 'var(--color-green)' : 'var(--color-border)' }} />}
          </div>
        )
      })}
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [completed, setCompleted] = useState<string[]>([])
  const [form, setForm] = useState({ name: '', email: '', roles: '', locations: '', salaryMin: '', salaryMax: '', remote: false, emailCh: true, telegram: false, web: true })

  const fetchState = useCallback(async () => {
    const res = await fetch('/api/onboarding').catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    if (d.completed) router.push('/dashboard')
    setCompleted(d.stepsCompleted ?? [])
  }, [router])

  useEffect(() => { fetchState() }, [fetchState])

  const markStep = async (stepId: string) => {
    await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepId }) }).catch(() => null)
    setCompleted(prev => prev.includes(stepId) ? prev : [...prev, stepId])
  }

  const next = async () => {
    await markStep(STEPS[step].id)
    if (step < STEPS.length - 1) setStep(step + 1)
  }

  const finish = async () => {
    await markStep(STEPS[step].id)
    await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) }).catch(() => null)
    router.push('/dashboard')
  }

  const skip = async () => {
    await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip: true }) }).catch(() => null)
    router.push('/dashboard')
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const
  const btnPrimary = { background: 'var(--color-green)', color: '#000' } as const
  const btnSecondary = { background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' } as const

  const stepContent = [
    /* Welcome */
    <div key="welcome" className="text-center py-8">
      <h2 className="text-xl font-bold text-[var(--color-white)] mb-3">Benvenuto in Job Hunter</h2>
      <p className="text-[11px] text-[var(--color-muted)] max-w-md mx-auto mb-6">Configuriamo insieme il tuo spazio di lavoro. In pochi passi avrai tutto pronto per iniziare la tua ricerca.</p>
      <div className="flex gap-2 justify-center">
        <button onClick={next} className="px-5 py-2 rounded-lg text-[11px] font-bold cursor-pointer" style={btnPrimary}>Iniziamo</button>
        <button onClick={skip} className="px-5 py-2 rounded-lg text-[11px] font-bold cursor-pointer" style={btnSecondary}>Salta configurazione</button>
      </div>
    </div>,
    /* Profile */
    <div key="profile" className="max-w-md mx-auto">
      <h2 className="text-lg font-bold text-[var(--color-white)] mb-1">Il tuo profilo</h2>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">Informazioni base per personalizzare l'esperienza.</p>
      <div className="flex flex-col gap-3">
        <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">NOME</label>
          <input autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="Il tuo nome" /></div>
        <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">EMAIL</label>
          <input type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="email@esempio.com" /></div>
        <div className="p-4 rounded-lg text-center" style={{ background: 'var(--color-deep)', border: '2px dashed var(--color-border)' }}>
          <p className="text-[10px] text-[var(--color-dim)]">Trascina il tuo CV qui o clicca per caricare</p>
          <p className="text-[8px] text-[var(--color-dim)] mt-1">PDF, DOC, DOCX (max 5MB)</p>
        </div>
      </div>
    </div>,
    /* Preferences */
    <div key="preferences" className="max-w-md mx-auto">
      <h2 className="text-lg font-bold text-[var(--color-white)] mb-1">Preferenze lavoro</h2>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">Dicci cosa cerchi per trovare le offerte migliori.</p>
      <div className="flex flex-col gap-3">
        <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RUOLI (separati da virgola)</label>
          <input value={form.roles} onChange={e => setForm({ ...form, roles: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="Frontend, Backend, Full Stack" /></div>
        <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">LOCALITÀ</label>
          <input value={form.locations} onChange={e => setForm({ ...form, locations: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="Milano, Roma, Remoto" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RAL MINIMA</label>
            <input type="number" value={form.salaryMin} onChange={e => setForm({ ...form, salaryMin: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="30000" /></div>
          <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RAL MASSIMA</label>
            <input type="number" value={form.salaryMax} onChange={e => setForm({ ...form, salaryMax: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="50000" /></div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.remote} onChange={e => setForm({ ...form, remote: e.target.checked })} />
          <span className="text-[10px] text-[var(--color-muted)]">Includi posizioni full remote</span>
        </label>
      </div>
    </div>,
    /* Channels */
    <div key="channels" className="max-w-md mx-auto">
      <h2 className="text-lg font-bold text-[var(--color-white)] mb-1">Canali notifica</h2>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">Come vuoi ricevere gli aggiornamenti?</p>
      <div className="flex flex-col gap-3">
        {([['emailCh', 'Email', 'Ricevi aggiornamenti via email'], ['telegram', 'Telegram', 'Notifiche istantanee via bot Telegram'], ['web', 'Web Push', 'Notifiche nel browser']] as const).map(([key, label, desc]) => (
          <div key={key} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
            <div><p className="text-[11px] text-[var(--color-bright)] font-medium">{label}</p><p className="text-[9px] text-[var(--color-dim)]">{desc}</p></div>
            <button onClick={() => setForm({ ...form, [key]: !form[key] })} className="text-[9px] font-bold px-3 py-1 rounded cursor-pointer"
              style={{ background: form[key] ? 'var(--color-green)' : 'var(--color-deep)', color: form[key] ? '#000' : 'var(--color-dim)' }}>{form[key] ? 'ON' : 'OFF'}</button>
          </div>
        ))}
      </div>
    </div>,
    /* Summary */
    <div key="summary" className="max-w-md mx-auto">
      <h2 className="text-lg font-bold text-[var(--color-white)] mb-1">Riepilogo</h2>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">Ecco un riepilogo della tua configurazione.</p>
      <div className="flex flex-col gap-2">
        {[['Profilo', `${form.name || '—'} · ${form.email || '—'}`], ['Ruoli', form.roles || '—'], ['Località', form.locations || '—'], ['RAL', `${form.salaryMin || '?'}–${form.salaryMax || '?'}€`], ['Remote', form.remote ? 'Sì' : 'No'],
          ['Canali', [form.emailCh && 'Email', form.telegram && 'Telegram', form.web && 'Web'].filter(Boolean).join(', ') || '—']].map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-2 rounded" style={{ background: 'var(--color-row)' }}>
            <span className="text-[9px] text-[var(--color-dim)]">{k}</span>
            <span className="text-[9px] text-[var(--color-muted)] font-medium">{v}</span>
          </div>
        ))}
      </div>
    </div>,
  ]

  return (
    <div className="max-w-2xl mx-auto py-8" style={{ animation: 'fade-in 0.35s ease both' }}>
      <Stepper current={step} completed={completed} />
      <div className="min-h-[320px]">{stepContent[step]}</div>
      {step > 0 && (
        <div className="flex justify-between mt-6">
          <button onClick={() => setStep(step - 1)} className="px-4 py-2 rounded-lg text-[10px] font-bold cursor-pointer" style={btnSecondary}>Indietro</button>
          {step < STEPS.length - 1
            ? <button onClick={next} className="px-4 py-2 rounded-lg text-[10px] font-bold cursor-pointer" style={btnPrimary}>Avanti</button>
            : <button onClick={finish} className="px-4 py-2 rounded-lg text-[10px] font-bold cursor-pointer" style={btnPrimary}>Completa setup</button>}
        </div>
      )}
    </div>
  )
}
