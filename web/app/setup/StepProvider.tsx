'use client'

import { PROVIDERS } from './providers'
import { Card, NavButtons, btnPrimary } from './ui'
import type { FormState } from './types'

interface Props {
  form: FormState
  set:  (f: Partial<FormState>) => void
  next: () => void
}

export function StepProvider({ form, set, next }: Props) {
  return (
    <Card title="Provider AI" sub="Scegli il provider di intelligenza artificiale">
      <div className="flex flex-col gap-2">
        {PROVIDERS.map(p => (
          <button key={p.value}
            onClick={() => set({ provider: p, model: p.models[0].value, authMethod: p.authMethods[0] })}
            className="text-left px-4 py-3 rounded border transition-all cursor-pointer"
            style={{
              borderColor: form.provider?.value === p.value ? 'var(--color-green)' : 'var(--color-border)',
              background:  form.provider?.value === p.value ? 'rgba(0,232,122,0.06)' : 'var(--color-card)',
              color: 'var(--color-bright)',
            }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">{p.label}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-green)' }}>{p.hint}</span>
            </div>
          </button>
        ))}
      </div>
      <NavButtons onNext={next} disabled={!form.provider} />
    </Card>
  )
}
