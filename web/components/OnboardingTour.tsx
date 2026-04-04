'use client'

import { useEffect, useState, useCallback } from 'react'

type Step = {
  id: string
  title: string
  description: string
  selector?: string
  position: 'top' | 'bottom' | 'right' | 'left'
}

const STEPS: Step[] = [
  {
    id: 'sidebar',
    title: 'Navigazione',
    description: 'Usa la sidebar per accedere a tutte le sezioni: agenti, sessioni, analytics e impostazioni.',
    selector: 'nav[aria-label="sidebar"]',
    position: 'right',
  },
  {
    id: 'dashboard',
    title: 'Overview',
    description: 'La dashboard mostra lo stato del team in tempo reale — agenti attivi, token, costi e plugin.',
    selector: '[data-tour="overview"]',
    position: 'bottom',
  },
  {
    id: 'search',
    title: 'Ricerca globale',
    description: 'Premi Cmd+K per cercare agenti, sessioni, task e pagine ovunque nella dashboard.',
    selector: '[data-tour="search"]',
    position: 'bottom',
  },
  {
    id: 'settings',
    title: 'Impostazioni',
    description: 'Configura provider AI, API key, bot Telegram e cron job dalla pagina impostazioni.',
    selector: '[data-tour="settings"]',
    position: 'top',
  },
]

type TooltipProps = { step: Step; index: number; total: number; onNext: () => void; onSkip: () => void }

function Tooltip({ step, index, total, onNext, onSkip }: TooltipProps) {
  return (
    <div
      className="fixed z-[9999] w-72 rounded-xl p-4 flex flex-col gap-3"
      style={{
        bottom: step.position === 'bottom' ? 'auto' : '2rem',
        top: step.position === 'bottom' ? '4rem' : 'auto',
        right: step.position === 'right' ? 'auto' : '1.5rem',
        left: step.position === 'right' ? '14rem' : 'auto',
        background: 'var(--color-panel)',
        border: '1px solid var(--color-green)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--color-green)' }}>
          {index + 1} / {total}
        </p>
        <button
          onClick={onSkip}
          className="text-[10px] cursor-pointer"
          style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
        >
          salta
        </button>
      </div>
      <p className="text-[13px] font-bold" style={{ color: 'var(--color-white)' }}>{step.title}</p>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>{step.description}</p>
      <button
        onClick={onNext}
        className="py-2 rounded text-[11px] font-bold cursor-pointer"
        style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}
      >
        {index < STEPS.length - 1 ? 'Avanti →' : 'Fine'}
      </button>
    </div>
  )
}

export default function OnboardingTour() {
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    fetch('/api/onboarding')
      .then(r => r.json())
      .then(s => { if (!s.completed) setActive(true) })
      .catch(() => {})
  }, [])

  const complete = useCallback(() => {
    fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) }).catch(() => {})
    setActive(false)
  }, [])

  const skip = useCallback(() => {
    fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip: true }) }).catch(() => {})
    setActive(false)
  }, [])

  const next = useCallback(() => {
    const s = STEPS[step]
    fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepId: s.id }) }).catch(() => {})
    if (step < STEPS.length - 1) setStep(i => i + 1)
    else complete()
  }, [step, complete])

  if (!active) return null

  return (
    <>
      <div className="fixed inset-0 z-[9998]" style={{ background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
      <Tooltip step={STEPS[step]} index={step} total={STEPS.length} onNext={next} onSkip={skip} />
    </>
  )
}
