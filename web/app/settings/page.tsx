'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { Tabs, Tab } from '../components/Tabs'
import { useToast } from '../components/Toast'

type NotifKey = 'telegram' | 'email' | 'desktop'
type Settings = { app_name: string; language: string; notifications: Record<NotifKey, boolean> }

const DEFAULTS: Settings = { app_name: 'Job Hunter Team', language: 'it', notifications: { telegram: true, email: false, desktop: false } }

const inp: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'var(--color-card)',
  color: 'var(--color-bright)', borderRadius: 6, fontSize: 11,
  padding: '6px 10px', fontFamily: 'var(--font-mono)', width: '100%',
  transition: 'border-color 0.15s',
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {hint && <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>{hint}</p>}
      {children}
    </div>
  )
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none" onClick={() => onChange(!checked)}>
      <div className="relative w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? 'var(--color-green)' : 'var(--color-border)' }}>
        <div className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{ background: 'white', transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
      </div>
      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
    </label>
  )
}

function SaveBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} className="self-start px-5 py-2 rounded text-[11px] font-bold cursor-pointer transition-all"
      style={{ background: busy ? 'var(--color-border)' : 'var(--color-green)', color: busy ? 'var(--color-dim)' : 'var(--color-void)', border: 'none' }}>
      {busy ? 'Salvataggio…' : 'Salva'}
    </button>
  )
}

type TabId = 'general' | 'notifications' | 'security' | 'danger'

export default function SettingsPage() {
  const [s, setS]       = useState<Settings>(DEFAULTS)
  const [loading, setL] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab]   = useState<TabId>('general')
  const { toast }    = useToast()

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(({ config }) => {
      if (config) setS({
        app_name: config.app?.name ?? DEFAULTS.app_name,
        language: config.app?.language ?? DEFAULTS.language,
        notifications: { ...DEFAULTS.notifications, ...config.notifications },
      })
      setL(false)
    }).catch(() => setL(false))
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: { name: s.app_name, language: s.language }, notifications: s.notifications }) })
      const d = await r.json()
      d.ok ? toast('Impostazioni salvate', 'success')
           : toast(d.error ?? 'Errore', 'error')
    } catch { toast('Errore di rete', 'error') }
    finally { setBusy(false) }
  }, [s, toast])

  const dangerAction = useCallback(async (act: string, label: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _action: act }) })
      const d = await r.json()
      d.ok ? toast(`${label} completato`, 'success')
           : toast(d.error ?? 'Errore', 'error')
    } catch { toast('Errore di rete', 'error') }
    finally { setBusy(false) }
  }, [toast])

  if (loading) return <main className="p-10"><p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p></main>

  const TABS: Tab<TabId>[] = [
    { id: 'general',       label: 'Generale' },
    { id: 'notifications', label: 'Notifiche' },
    { id: 'security',      label: 'Sicurezza' },
    { id: 'danger',        label: 'Danger Zone' },
  ]

  return (
    <main className="min-h-screen px-6 py-10" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="max-w-2xl flex flex-col gap-6">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
            <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
            <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Impostazioni</span>
          </nav>
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>Impostazioni</h1>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="flex flex-col gap-5 pt-1">
          {tab === 'general' && <>
            <Row label="Nome applicazione">
              <input style={inp} value={s.app_name} onChange={e => setS(p => ({ ...p, app_name: e.target.value }))} />
            </Row>
            <Row label="Lingua default">
              <select style={inp} value={s.language} onChange={e => setS(p => ({ ...p, language: e.target.value }))} aria-label="Lingua">
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </Row>
            <SaveBtn busy={busy} onClick={save} />
          </>}

          {tab === 'notifications' && <>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>Canali</p>
            {(['telegram', 'email', 'desktop'] as NotifKey[]).map(k => (
              <Toggle key={k} checked={s.notifications[k]}
                label={k === 'telegram' ? 'Telegram' : k === 'email' ? 'Email' : 'Desktop (browser)'}
                onChange={v => setS(p => ({ ...p, notifications: { ...p.notifications, [k]: v } }))} />
            ))}
            <SaveBtn busy={busy} onClick={save} />
          </>}

          {tab === 'security' && <>
            <Row label="Nuova password" hint="Disponibile in una prossima versione">
              <input type="password" style={{ ...inp, opacity: 0.4, cursor: 'not-allowed' }} disabled placeholder="••••••••" />
            </Row>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
              <span className="text-[9px] px-2 py-0.5 rounded"
                style={{ background: 'rgba(255,196,0,0.1)', color: 'var(--color-yellow)', border: '1px solid rgba(255,196,0,0.2)' }}>
                Presto disponibile
              </span>
              <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>2FA via TOTP (Google Authenticator)</p>
            </div>
          </>}

          {tab === 'danger' && <>
            <div className="px-4 py-3 rounded" style={{ background: 'rgba(255,69,96,0.06)', border: '1px solid rgba(255,69,96,0.2)' }}>
              <p className="text-[10px] font-bold" style={{ color: 'var(--color-red)' }}>Attenzione — azioni irreversibili</p>
            </div>
            {[
              { act: 'reset_config', label: 'Reset configurazione', desc: 'Ripristina jht.config.json ai valori di default' },
              { act: 'clear_cache',  label: 'Svuota cache',         desc: 'Elimina tutti i file in ~/.jht/cache/' },
            ].map(({ act, label, desc }) => (
              <div key={act} className="flex items-center justify-between gap-4 px-4 py-3 rounded"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--color-muted)' }}>{label}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{desc}</p>
                </div>
                <button onClick={() => dangerAction(act, label)} disabled={busy}
                  className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer flex-shrink-0 transition-all"
                  style={{ border: '1px solid rgba(255,69,96,0.4)', color: 'var(--color-red)', background: 'transparent' }}>
                  {label}
                </button>
              </div>
            ))}
          </>}
        </div>
      </div>
    </main>
  )
}
