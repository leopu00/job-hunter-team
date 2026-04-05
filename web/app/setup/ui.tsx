'use client'

/* Componenti UI condivisi per il wizard setup */

import React from 'react'

export const inputCls = [
  'w-full px-3 py-2 rounded text-[12px] font-mono',
  'bg-[var(--color-card)] border border-[var(--color-border)]',
  'outline-none focus:border-[var(--color-green)] transition-colors',
].join(' ')

export const btnPrimary: React.CSSProperties  = { background: 'var(--color-green)', color: '#000' }
export const btnSecondary: React.CSSProperties = {
  border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent',
}

export const STEPS = ['provider', 'auth', 'model', 'telegram', 'summary'] as const
export type Step = (typeof STEPS)[number]

export const STEP_LABELS: Record<Step, string> = {
  provider: 'Provider', auth: 'Auth', model: 'Modello',
  telegram: 'Telegram', summary: 'Riepilogo',
}

export function StepBar({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current)
  return (
    <div className="flex items-center gap-1 mb-8 flex-wrap">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{
              background: i <= idx ? 'var(--color-green)' : 'var(--color-border)',
              color:      i <= idx ? '#000' : 'var(--color-dim)',
            }}>{i + 1}</div>
          <span className="text-[9px] tracking-widest uppercase hidden sm:inline"
            style={{ color: i === idx ? 'var(--color-bright)' : 'var(--color-dim)' }}>
            {STEP_LABELS[s]}
          </span>
          {i < STEPS.length - 1 && <span className="text-[var(--color-border)] mx-1">›</span>}
        </div>
      ))}
    </div>
  )
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--color-border)]">
        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-bright)' }}>{title}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-dim)' }}>{sub}</p>}
      </div>
      <div className="px-6 py-6 flex flex-col gap-4">{children}</div>
    </div>
  )
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold tracking-widest uppercase"
        style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
      {error && <p role="alert" className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
    </div>
  )
}

export function NavButtons({
  onBack, onNext, nextLabel = 'Continua', disabled = false,
}: { onBack?: () => void; onNext: () => void; nextLabel?: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3">
      {onBack && (
        <button onClick={onBack} className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer" style={btnSecondary}>
          Indietro
        </button>
      )}
      <button onClick={onNext} disabled={disabled}
        className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
        style={disabled ? { background: 'var(--color-border)', color: 'var(--color-dim)' } : btnPrimary}>
        {nextLabel}
      </button>
    </div>
  )
}
