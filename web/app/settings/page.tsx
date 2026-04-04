'use client'

import { useEffect, useState } from 'react'
import { Card, Field, inputCls, btnPrimary, btnSecondary } from '../setup/ui'

type TgStatus = { configured: boolean; connected: boolean; running: boolean; botUsername: string | null; botName: string | null; mode: string | null }

function TelegramStatusWidget() {
  const [s, setS] = useState<TgStatus | null>(null)
  useEffect(() => {
    const load = () => fetch('/api/telegram/status').then(r => r.json()).then(setS).catch(() => null)
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])
  if (!s) return <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>Verifica stato…</p>
  const dot = s.connected ? 'var(--color-green)' : s.configured ? 'var(--color-yellow)' : 'var(--color-dim)'
  const label = s.connected ? 'connesso' : s.configured ? 'token non valido' : 'non configurato'
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded border text-[11px]"
      style={{ borderColor: s.connected ? 'rgba(0,232,122,0.2)' : 'var(--color-border)', background: 'var(--color-card)' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: dot, animation: s.connected ? 'pulse-dot 2.5s ease-in-out infinite' : undefined }}>●</span>
        <span style={{ color: dot }}>{label}</span>
        {s.running && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded border" style={{ color: 'var(--color-blue)', borderColor: 'rgba(77,159,255,0.25)' }}>tmux attivo</span>}
      </div>
      {s.botUsername && <p className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>@{s.botUsername} · {s.botName}</p>}
    </div>
  )
}

type Provider = 'claude' | 'openai' | 'minimax'

interface SettingsForm {
  activeProvider: Provider
  apiKeys: Record<Provider, string>
  telegramEnabled: boolean
  botToken: string
  chatId: string
  cronEnabled: boolean
}

const EMPTY: SettingsForm = {
  activeProvider: 'claude',
  apiKeys: { claude: '', openai: '', minimax: '' },
  telegramEnabled: false,
  botToken: '',
  chatId: '',
  cronEnabled: false,
}

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude (Anthropic)',
  openai: 'OpenAI',
  minimax: 'MiniMax',
}

export default function SettingsPage() {
  const [form, setForm]       = useState<SettingsForm>(EMPTY)
  const [status, setStatus]   = useState<'idle' | 'loading' | 'saving' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg]   = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(({ config }) => {
        if (!config) { setStatus('idle'); return }
        setForm({
          activeProvider: config.active_provider ?? 'claude',
          apiKeys: {
            claude:  config.providers?.claude?.api_key  ?? '',
            openai:  config.providers?.openai?.api_key  ?? '',
            minimax: config.providers?.minimax?.api_key ?? '',
          },
          telegramEnabled: !!config.channels?.telegram?.bot_token,
          botToken: config.channels?.telegram?.bot_token ?? '',
          chatId:   config.channels?.telegram?.chat_id   ?? '',
          cronEnabled: config.cron_enabled ?? false,
        })
        setStatus('idle')
      })
      .catch(() => setStatus('idle'))
  }, [])

  const set = (p: Partial<SettingsForm>) => setForm(f => ({ ...f, ...p }))

  const save = async () => {
    setStatus('saving')
    const body = {
      active_provider: form.activeProvider,
      providers: {
        [form.activeProvider]: {
          name: form.activeProvider,
          auth_method: 'api_key',
          api_key: form.apiKeys[form.activeProvider],
        },
      },
      channels: form.telegramEnabled ? {
        telegram: { bot_token: form.botToken, chat_id: form.chatId },
      } : {},
      cron_enabled: form.cronEnabled,
    }
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json()
      if (data.ok) { setStatus('ok'); setTimeout(() => setStatus('idle'), 2000) }
      else { setErrMsg(data.error ?? 'errore'); setStatus('error') }
    } catch { setErrMsg('network error'); setStatus('error') }
  }

  if (status === 'loading') return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento configurazione…</p>
    </main>
  )

  return (
    <main className="min-h-screen px-5 py-10 flex flex-col items-center">
      <div className="w-full max-w-lg flex flex-col gap-6">

        <div className="mb-2">
          <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>impostazioni</p>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--color-white)' }}>Configurazione</h1>
        </div>

        {/* Provider AI */}
        <Card title="Provider AI" sub="Provider attivo e API key">
          <Field label="Provider attivo">
            <select value={form.activeProvider} onChange={e => set({ activeProvider: e.target.value as Provider })}
              className={inputCls} style={{ color: 'var(--color-bright)' }}>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </Field>
          <Field label={`API Key — ${PROVIDER_LABELS[form.activeProvider]}`}>
            <input type="password" placeholder="sk-••••••••" className={inputCls}
              value={form.apiKeys[form.activeProvider]}
              onChange={e => set({ apiKeys: { ...form.apiKeys, [form.activeProvider]: e.target.value } })}
              style={{ color: 'var(--color-bright)' }} />
          </Field>
        </Card>

        {/* Telegram */}
        <Card title="Telegram" sub="Notifiche e comandi via bot">
          <TelegramStatusWidget />
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.telegramEnabled}
              onChange={e => set({ telegramEnabled: e.target.checked })} />
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Abilita integrazione Telegram</span>
          </label>
          {form.telegramEnabled && <>
            <Field label="Bot Token">
              <input type="password" placeholder="123456:ABC-DEF…" className={inputCls}
                value={form.botToken} onChange={e => set({ botToken: e.target.value })}
                style={{ color: 'var(--color-bright)' }} />
            </Field>
            <Field label="Chat ID">
              <input type="text" placeholder="-100123456789" className={inputCls}
                value={form.chatId} onChange={e => set({ chatId: e.target.value })}
                style={{ color: 'var(--color-bright)' }} />
            </Field>
          </>}
        </Card>

        {/* Cron */}
        <Card title="Cron Jobs" sub="Esecuzione automatica schedulata">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.cronEnabled}
              onChange={e => set({ cronEnabled: e.target.checked })} />
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Abilita cron jobs automatici</span>
          </label>
        </Card>

        {/* Azioni */}
        <div className="flex gap-3">
          <a href="/" className="flex-1 py-2.5 rounded text-[12px] font-semibold text-center cursor-pointer" style={btnSecondary}>
            Annulla
          </a>
          <button onClick={save} disabled={status === 'saving'}
            className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
            style={status === 'saving' ? { background: 'var(--color-border)', color: 'var(--color-dim)' } : btnPrimary}>
            {status === 'saving' ? 'Salvataggio…' : status === 'ok' ? '✓ Salvato' : 'Salva configurazione'}
          </button>
        </div>
        {status === 'error' && <p className="text-[10px] text-center" style={{ color: 'var(--color-red)' }}>{errMsg}</p>}

      </div>
    </main>
  )
}
