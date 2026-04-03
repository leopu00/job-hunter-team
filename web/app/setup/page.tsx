'use client'

import { useState } from 'react'
import { STEPS, StepBar, type Step } from './ui'
import { INITIAL_FORM, type FormState } from './types'
import { StepProvider } from './StepProvider'
import { StepAuth }     from './StepAuth'
import { StepModel }    from './StepModel'
import { StepTelegram } from './StepTelegram'
import { StepSummary }  from './StepSummary'

export default function SetupPage() {
  const [step, setStep] = useState<Step>('provider')
  const [form, setForm] = useState<FormState>(INITIAL_FORM)

  const set  = (partial: Partial<FormState>) => setForm(f => ({ ...f, ...partial }))
  const next = () => setStep(s => STEPS[STEPS.indexOf(s) + 1])
  const back = () => setStep(s => STEPS[STEPS.indexOf(s) - 1])

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10"
      style={{ position: 'relative', zIndex: 1 }}>
      <div className="w-full max-w-lg" style={{ animation: 'fade-in 0.4s ease both' }}>

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full"
              style={{ background: 'var(--color-green)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[9px] font-semibold tracking-[0.2em] uppercase"
              style={{ color: 'var(--color-green)' }}>setup</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight leading-none mb-2"
            style={{ color: 'var(--color-white)' }}>
            Job Hunter<br /><span style={{ color: 'var(--color-green)' }}>Team</span>
          </h1>
          <p className="text-[11px] leading-relaxed max-w-xs mx-auto"
            style={{ color: 'var(--color-muted)' }}>
            Configura il team in pochi passi.
          </p>
        </div>

        <StepBar current={step} />

        {step === 'provider' && <StepProvider form={form} set={set} next={next} />}
        {step === 'auth'     && <StepAuth     form={form} set={set} next={next} back={back} />}
        {step === 'model'    && <StepModel    form={form} set={set} next={next} back={back} />}
        {step === 'telegram' && <StepTelegram form={form} set={set} next={next} back={back} />}
        {step === 'summary'  && <StepSummary  form={form} back={back} />}

        <p className="mt-6 text-center text-[9px]" style={{ color: 'var(--color-dim)' }}>
          v0.1.0-alpha · Job Hunter Team
        </p>
      </div>
    </main>
  )
}
