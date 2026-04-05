'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTheme, type Theme } from '../app/theme-provider'

type Prefs = {
  theme: Theme
  language: 'it' | 'en'
  notifications: { enabled: boolean; sound: boolean; desktop: boolean }
  shortcuts: Record<string, string>
}

const DEFAULTS: Prefs = {
  theme: 'dark', language: 'it',
  notifications: { enabled: true, sound: false, desktop: false },
  shortcuts: {},
}

const SHORTCUT_LABELS: Record<string, string> = {
  'cmd+k':     'Apri Command Palette',
  'cmd+/':     'Toggle sidebar',
  'g d':       'Vai a Dashboard',
  'g a':       'Vai a Agenti',
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1.5">
      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div onClick={() => onChange(!checked)}
        className="w-8 h-4 rounded-full transition-colors cursor-pointer relative"
        style={{ background: checked ? 'var(--color-green)' : 'var(--color-border)' }}>
        <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
          style={{ background: 'var(--color-bg)', left: checked ? '1.125rem' : '0.125rem' }} />
      </div>
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[9px] font-semibold tracking-[0.18em] uppercase mb-1" style={{ color: 'var(--color-dim)' }}>{title}</p>
      {children}
    </div>
  )
}

export default function UserPreferences({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme()
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULTS, theme: theme === 'system' ? 'dark' : theme })
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok'>('idle')

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(p => setPrefs({ ...DEFAULTS, ...p, notifications: { ...DEFAULTS.notifications, ...(p.notifications ?? {}) } })).catch(() => {})
  }, [])

  const patch = useCallback(async (partial: Partial<Prefs>) => {
    const next = { ...prefs, ...partial, notifications: { ...prefs.notifications, ...((partial.notifications as object) ?? {}) } } as Prefs
    setPrefs(next)
    setStatus('saving')
    try {
      await fetch('/api/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) })
      if (partial.theme) setTheme(partial.theme)
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 1500)
    } catch { setStatus('idle') }
  }, [prefs, setTheme])

  const reset = useCallback(async () => {
    await fetch('/api/preferences', { method: 'DELETE' })
    setPrefs({ ...DEFAULTS })
    setTheme('dark')
  }, [setTheme])

  return (
    <div className="flex flex-col gap-5 min-w-[280px]">
      <Section title="Aspetto">
        <label className="flex items-center justify-between py-1.5">
          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Tema</span>
          <div className="flex gap-1.5">
            {(['dark', 'light'] as const).map(t => (
              <button key={t} onClick={() => patch({ theme: t })}
                className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors"
                style={{ background: prefs.theme === t ? 'var(--color-green)' : 'var(--color-border)', color: prefs.theme === t ? 'var(--color-bg)' : 'var(--color-muted)' }}>
                {t === 'dark' ? 'Scuro' : 'Chiaro'}
              </button>
            ))}
          </div>
        </label>
        <label className="flex items-center justify-between py-1.5">
          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Lingua</span>
          <div className="flex gap-1.5">
            {(['it', 'en'] as const).map(l => (
              <button key={l} onClick={() => patch({ language: l })}
                className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors"
                style={{ background: prefs.language === l ? 'var(--color-green)' : 'var(--color-border)', color: prefs.language === l ? 'var(--color-bg)' : 'var(--color-muted)' }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </label>
      </Section>

      <Section title="Notifiche">
        <Toggle checked={prefs.notifications.enabled} label="Notifiche attive" onChange={v => patch({ notifications: { ...prefs.notifications, enabled: v } })} />
        <Toggle checked={prefs.notifications.sound}   label="Suono"           onChange={v => patch({ notifications: { ...prefs.notifications, sound:   v } })} />
        <Toggle checked={prefs.notifications.desktop} label="Desktop"         onChange={v => patch({ notifications: { ...prefs.notifications, desktop: v } })} />
      </Section>

      <Section title="Scorciatoie">
        {Object.entries(SHORTCUT_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between py-1">
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
            <kbd className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--color-border)', color: 'var(--color-dim)' }}>
              {prefs.shortcuts[key] ?? key}
            </kbd>
          </div>
        ))}
      </Section>

      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={reset} className="text-[10px] cursor-pointer" style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}>
          Ripristina default
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded text-[11px] font-semibold cursor-pointer"
          style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}>
          {status === 'saving' ? '…' : status === 'ok' ? '✓ Salvato' : 'Chiudi'}
        </button>
      </div>
    </div>
  )
}
