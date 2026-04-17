'use client'

import { useState } from 'react'
import { validateTelegramToken, validateChatId } from './providers'
import { Card, NavButtons, Field, inputCls } from './ui'
import type { FormState } from './types'

interface Props {
  form: FormState
  set:  (f: Partial<FormState>) => void
  next: () => void
  back: () => void
}

export function StepTelegram({ form, set, next, back }: Props) {
  const [tokenErr, setTokenErr] = useState<string>()
  const [chatErr,  setChatErr]  = useState<string>()

  const validate = () => {
    if (!form.useTelegram) { next(); return }
    const te = validateTelegramToken(form.botToken)
    const ce = validateChatId(form.chatId)
    setTokenErr(te); setChatErr(ce)
    if (!te && !ce) next()
  }

  return (
    <Card title="Telegram" sub="Notifiche via bot Telegram (opzionale)">
      {/* Toggle */}
      <div className="flex items-center gap-3">
        <button onClick={() => set({ useTelegram: !form.useTelegram })}
          className="relative w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0"
          style={{ background: form.useTelegram ? 'var(--color-green)' : 'var(--color-border)' }}>
          <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            style={{ transform: form.useTelegram ? 'translateX(22px)' : 'translateX(2px)' }} />
        </button>
        <span className="text-[12px]" style={{ color: 'var(--color-base)' }}>Configura bot Telegram</span>
      </div>

      {form.useTelegram && (
        <>
          <Field label="Bot Token" error={tokenErr}>
            <input type="text" value={form.botToken} placeholder="123456:ABCdefGHI..."
              onChange={e => { set({ botToken: e.target.value }); setTokenErr(undefined) }}
              className={inputCls} style={{ color: 'var(--color-bright)' }} />
          </Field>
          <Field label="Chat ID (opzionale)" error={chatErr}>
            <input type="text" value={form.chatId} placeholder="123456789"
              onChange={e => { set({ chatId: e.target.value }); setChatErr(undefined) }}
              className={inputCls} style={{ color: 'var(--color-bright)' }} />
          </Field>
          <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>
            Crea un bot con @BotFather su Telegram per ottenere il token.
          </p>
        </>
      )}

      <NavButtons onBack={back} onNext={validate} />
    </Card>
  )
}
