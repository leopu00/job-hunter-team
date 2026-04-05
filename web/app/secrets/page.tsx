'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type SecretType = 'api_key' | 'token' | 'password' | 'webhook' | 'other'
type Secret = { id: string; name: string; type: SecretType; value: string; masked: boolean; createdAt: number }

const TYPE_LABEL: Record<SecretType, string> = {
  api_key: 'API Key', token: 'Token', password: 'Password', webhook: 'Webhook', other: 'Altro',
}
const TYPE_ICON: Record<SecretType, string> = {
  api_key: '🔑', token: '🎫', password: '🔒', webhook: '🪝', other: '◆',
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName]         = useState('')
  const [type, setType]         = useState<SecretType>('api_key')
  const [value, setValue]       = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied]     = useState<string | null>(null)

  const fetchSecrets = useCallback(async () => {
    const res = await fetch('/api/secrets').catch(() => null)
    if (res?.ok) { const d = await res.json(); setSecrets(d.secrets ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchSecrets() }, [fetchSecrets])

  const reveal = async (id: string) => {
    const res = await fetch(`/api/secrets?id=${id}`).catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    const updated = d.secrets?.find((s: Secret) => s.id === id)
    if (updated) setSecrets(prev => prev.map(s => s.id === id ? updated : s))
  }

  const copy = async (secret: Secret) => {
    let val = secret.value
    if (secret.masked) {
      const res = await fetch(`/api/secrets?id=${secret.id}`).catch(() => null)
      if (res?.ok) { const d = await res.json(); val = d.secrets?.find((s: Secret) => s.id === secret.id)?.value ?? val }
    }
    await navigator.clipboard.writeText(val).catch(() => null)
    setCopied(secret.id)
    setTimeout(() => setCopied(null), 1500)
  }

  const del = async (id: string) => {
    await fetch(`/api/secrets?id=${id}`, { method: 'DELETE' }).catch(() => null)
    setSecrets(prev => prev.filter(s => s.id !== id))
  }

  const create = async () => {
    if (!name.trim() || !value.trim()) return
    setCreating(true)
    await fetch('/api/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type, value: value.trim() }) }).catch(() => null)
    setName(''); setValue(''); setType('api_key'); setShowForm(false); setCreating(false)
    fetchSecrets()
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Secrets</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Secrets</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{secrets.length} secrets salvati</p>
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all"
            style={{ background: showForm ? 'var(--color-border)' : 'var(--color-green)', color: showForm ? 'var(--color-muted)' : '#000', cursor: 'pointer' }}>
            {showForm ? '✕ annulla' : '+ nuovo secret'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]" style={{ animation: 'fade-in 0.2s ease both' }}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome (es. OPENAI_KEY)" aria-label="Nome segreto" className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }} />
              <select value={type} onChange={e => setType(e.target.value as SecretType)} aria-label="Tipo segreto" className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                {(Object.keys(TYPE_LABEL) as SecretType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <input type="password" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="Valore…" aria-label="Valore segreto" className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }} />
              <button onClick={create} disabled={!name.trim() || !value.trim() || creating}
                className="px-5 py-2 rounded-lg text-[11px] font-bold flex-shrink-0"
                style={{ background: name.trim() && value.trim() ? 'var(--color-green)' : 'var(--color-border)', color: name.trim() && value.trim() ? '#000' : 'var(--color-dim)', cursor: name.trim() && value.trim() ? 'pointer' : 'default' }}>
                {creating ? '…' : 'salva'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}
      {!loading && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {secrets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-4xl">🔐</span>
              <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessun secret</p>
              <p className="text-[10px] text-[var(--color-dim)]">Salva qui le tue API key e token cifrati.</p>
            </div>
          ) : secrets.map(s => (
            <div key={s.id} className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-base flex-shrink-0">{TYPE_ICON[s.type]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[var(--color-bright)] truncate">{s.name}</p>
                <p className="text-[10px] font-mono text-[var(--color-dim)] mt-0.5">{s.masked ? s.value : s.value} · {TYPE_LABEL[s.type]} · {fmtDate(s.createdAt)}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => reveal(s.id)} aria-label={s.masked ? 'Mostra valore' : 'Nascondi valore'} className="px-2 py-1 rounded text-[9px] cursor-pointer transition-colors" style={{ border: '1px solid var(--color-border)', color: s.masked ? 'var(--color-dim)' : 'var(--color-green)', background: 'transparent' }}>{s.masked ? '👁' : '🙈'}</button>
                <button onClick={() => copy(s)} aria-label="Copia valore" className="px-2 py-1 rounded text-[9px] cursor-pointer transition-colors" style={{ border: '1px solid var(--color-border)', color: copied === s.id ? 'var(--color-green)' : 'var(--color-dim)', background: 'transparent' }}>{copied === s.id ? '✓' : '⎘'}</button>
                <button onClick={() => del(s.id)} aria-label="Elimina segreto" className="px-2 py-1 rounded text-[9px] cursor-pointer transition-colors" style={{ border: '1px solid rgba(255,69,96,0.2)', color: 'var(--color-red)', background: 'transparent' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
