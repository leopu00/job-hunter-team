'use client'

import { useState } from 'react'
import { validateApiKey, validateEmail } from './providers'
import { Card, NavButtons, Field, inputCls, btnPrimary, btnSecondary } from './ui'
import type { FormState } from './types'

interface Props {
  form: FormState
  set:  (f: Partial<FormState>) => void
  next: () => void
  back: () => void
}

export function StepAuth({ form, set, next, back }: Props) {
  const p = form.provider!
  const [err, setErr] = useState<string>()
  const canSub = p.authMethods.includes('subscription')

  const validate = () => {
    const e = form.authMethod === 'api_key'
      ? validateApiKey(p, form.apiKey)
      : validateEmail(form.email)
    if (e) { setErr(e); return }
    setErr(undefined)
    next()
  }

  return (
    <Card title="Autenticazione" sub={`Configura l'accesso per ${p.label}`}>
      {canSub && (
        <div className="flex gap-2">
          {(['api_key', 'subscription'] as const).map(m => (
            <button key={m} onClick={() => { set({ authMethod: m }); setErr(undefined) }}
              className="flex-1 py-2 rounded text-[11px] font-semibold tracking-wide cursor-pointer transition-all"
              style={form.authMethod === m ? btnPrimary : { ...btnSecondary, borderRadius: '4px' }}>
              {m === 'api_key' ? 'API Key' : 'Subscription'}
            </button>
          ))}
        </div>
      )}

      {form.authMethod === 'api_key' ? (
        <Field label="API Key" error={err}>
          <input type="password" value={form.apiKey} placeholder={p.keyPlaceholder}
            onChange={e => { set({ apiKey: e.target.value }); setErr(undefined) }}
            className={inputCls} style={{ color: 'var(--color-bright)' }} autoComplete="off" required />
        </Field>
      ) : (
        <Field label="Email account" error={err}>
          <input type="email" value={form.email} placeholder="nome@email.com"
            onChange={e => { set({ email: e.target.value }); setErr(undefined) }}
            className={inputCls} style={{ color: 'var(--color-bright)' }} autoComplete="email" required />
        </Field>
      )}

      <NavButtons onBack={back} onNext={validate} />
    </Card>
  )
}
