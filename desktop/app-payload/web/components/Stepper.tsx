'use client'

import { useState } from 'react'

export interface StepConfig {
  id: string
  label: string
  /** Icona opzionale (emoji o stringa) */
  icon?: string
  /** Se presente, chiamato prima di avanzare — ritorna true se ok, false/string se errore */
  validate?: () => boolean | string
}

export interface StepperProps {
  steps: StepConfig[]
  /** Renderizza il contenuto dello step corrente */
  renderStep: (step: StepConfig, index: number) => React.ReactNode
  /** Chiamato quando l'utente completa l'ultimo step */
  onComplete?: () => void
  /** Label bottone completamento */
  completeLabel?: string
  /** Consente di tornare indietro dagli step già validati */
  allowBack?: boolean
}

type StepState = 'pending' | 'active' | 'done' | 'error'

export default function Stepper({
  steps,
  renderStep,
  onComplete,
  completeLabel = 'Completa',
  allowBack = true,
}: StepperProps) {
  const [current, setCurrent]   = useState(0)
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [errors, setErrors]     = useState<Record<number, string>>({})

  const stepState = (i: number): StepState => {
    if (errors[i])       return 'error'
    if (completed.has(i)) return 'done'
    if (i === current)   return 'active'
    return 'pending'
  }

  const goTo = (i: number) => {
    if (i === current) return
    // Avanti: solo se tutti gli step precedenti sono completati
    if (i > current) return
    // Indietro: solo se allowBack
    if (!allowBack) return
    setErrors(e => { const n = { ...e }; delete n[current]; return n })
    setCurrent(i)
  }

  const handleNext = () => {
    const step = steps[current]
    if (step.validate) {
      const result = step.validate()
      if (result !== true) {
        setErrors(e => ({ ...e, [current]: typeof result === 'string' ? result : 'Completa questo step prima di continuare.' }))
        return
      }
    }
    setErrors(e => { const n = { ...e }; delete n[current]; return n })
    setCompleted(s => new Set(s).add(current))
    if (current === steps.length - 1) {
      onComplete?.()
    } else {
      setCurrent(c => c + 1)
    }
  }

  const handleBack = () => {
    if (current > 0 && allowBack) setCurrent(c => c - 1)
  }

  const isLast = current === steps.length - 1

  return (
    <div className="flex flex-col gap-6">
      {/* Header steps */}
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const state = stepState(i)
          const isClickable = allowBack && (completed.has(i) || i < current)
          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step circle */}
              <button
                onClick={() => isClickable ? goTo(i) : undefined}
                disabled={!isClickable && i !== current}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${
                    state === 'active'  ? 'var(--color-green)'  :
                    state === 'done'    ? 'var(--color-green)'  :
                    state === 'error'   ? 'var(--color-red)'    :
                    'var(--color-border)'
                  }`,
                  background: state === 'done' ? 'var(--color-green)' : 'var(--color-panel)',
                  color: state === 'done' ? '#000' : state === 'active' ? 'var(--color-green)' : state === 'error' ? 'var(--color-red)' : 'var(--color-dim)',
                  cursor: isClickable ? 'pointer' : 'default',
                  fontSize: 12, fontWeight: 700, transition: 'all 0.2s ease',
                }}>
                {state === 'done' ? '✓' : state === 'error' ? '!' : step.icon ?? (i + 1)}
              </button>

              {/* Label sotto */}
              <div style={{ position: 'absolute', marginTop: 48 }}>
                <span style={{
                  fontSize: 9, whiteSpace: 'nowrap',
                  color: state === 'active' ? 'var(--color-bright)' : state === 'done' ? 'var(--color-green)' : 'var(--color-dim)',
                  fontWeight: state === 'active' ? 700 : 400,
                }}>{step.label}</span>
              </div>

              {/* Linea connettore */}
              {i < steps.length - 1 && (
                <div style={{
                  flex: 1, height: 2, margin: '0 4px',
                  background: completed.has(i) ? 'var(--color-green)' : 'var(--color-border)',
                  transition: 'background 0.3s ease',
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Contenuto step */}
      <div
        className="rounded-lg border p-5"
        style={{ borderColor: errors[current] ? 'var(--color-red)' : 'var(--color-border)', background: 'var(--color-panel)', marginTop: 16 }}>
        {/* Titolo step */}
        <div className="flex items-center gap-2 mb-4">
          {steps[current].icon && <span className="text-base">{steps[current].icon}</span>}
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-bright)' }}>
            {steps[current].label}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-dim)' }}>
            — Step {current + 1} di {steps.length}
          </span>
        </div>

        {/* Errore validazione */}
        {errors[current] && (
          <div className="mb-3 px-3 py-2 rounded text-[10px]" style={{ background: 'rgba(255,59,59,0.1)', color: 'var(--color-red)', border: '1px solid var(--color-red)' }}>
            {errors[current]}
          </div>
        )}

        {renderStep(steps[current], current)}
      </div>

      {/* Navigazione */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={current === 0 || !allowBack}
          className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
          style={{
            background: 'var(--color-panel)', border: '1px solid var(--color-border)',
            color: current === 0 || !allowBack ? 'var(--color-border)' : 'var(--color-muted)',
            cursor: current === 0 || !allowBack ? 'default' : 'pointer',
          }}>
          ← Indietro
        </button>

        {/* Indicatore dots */}
        <div className="flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === current ? 16 : 6, height: 6, borderRadius: 3,
              background: completed.has(i) ? 'var(--color-green)' : i === current ? 'var(--color-muted)' : 'var(--color-border)',
              transition: 'all 0.2s ease',
            }} />
          ))}
        </div>

        <button
          onClick={handleNext}
          className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
          style={{
            background: 'var(--color-green)', border: '1px solid var(--color-green)',
            color: '#000', cursor: 'pointer',
          }}>
          {isLast ? completeLabel : 'Avanti →'}
        </button>
      </div>
    </div>
  )
}
