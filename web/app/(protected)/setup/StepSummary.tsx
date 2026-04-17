'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, btnPrimary, btnSecondary } from './ui'
import type { FormState } from './types'

interface Props { form: FormState; back: () => void }

export function StepSummary({ form, back }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string>()
  const p = form.provider!

  const rows: [string, string][] = [
    ['Provider',  p.label],
    ['Modello',   form.model],
    ['Auth',      form.authMethod === 'api_key'
      ? `API Key (${form.apiKey.slice(0, 8)}••••)` : `Subscription (${form.email})`],
    ['Telegram',  form.useTelegram ? 'configurato' : 'non configurato'],
  ]

  const save = async () => {
    setSaving(true); setError(undefined)
    const provConf: Record<string, unknown> = {
      name: p.value, auth_method: form.authMethod, model: form.model,
    }
    if (form.authMethod === 'api_key') provConf.api_key = form.apiKey
    else provConf.subscription = { email: form.email }

    // workspace path e' fisso (~/.jht + ~/Documents/Job Hunter Team),
    // l'API /api/setup lo hardcoda da @/lib/jht-paths e ignora il body.
    const body = {
      active_provider: p.value,
      providers: { [p.value]: provConf },
      channels: form.useTelegram ? {
        telegram: {
          bot_token: form.botToken,
          ...(form.chatId.trim() ? { chat_id: form.chatId.trim() } : {}),
        },
      } : {},
    }

    try {
      const res  = await fetch('/api/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Errore salvataggio'); setSaving(false); return }
      router.push('/dashboard')
    } catch { setError('Errore di rete'); setSaving(false) }
  }

  return (
    <Card title="Riepilogo" sub="Verifica i dati prima di salvare">
      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2.5">
            <span className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: 'var(--color-dim)' }}>{k}</span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--color-bright)' }}>{v}</span>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-[11px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
      <div className="flex gap-3">
        <button onClick={back} disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer" style={btnSecondary}>
          Modifica
        </button>
        <button onClick={save} disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
          style={saving ? { background: 'var(--color-border)', color: 'var(--color-dim)' } : btnPrimary}>
          {saving ? 'Salvataggio…' : 'Salva e avvia'}
        </button>
      </div>
    </Card>
  )
}
