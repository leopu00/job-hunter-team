'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ProviderInfo = {
  id: string
  label: string
  available: boolean
  active: boolean
  authMethod: string
  models: string[]
  activeModel?: string
  keySource: 'config' | 'env' | null
  installedVersion?: string | null
  latestVersion?: string | null
  updateAvailable?: boolean
  updatable?: boolean
}

type ProvidersData = {
  providers: ProviderInfo[]
  activeProvider: string
  configLoaded: boolean
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🟠',
  claude: '🟠',
  openai: '🟢',
  kimi: '🌙',
  minimax: '🔵',
}

function ProviderCard({ provider, onUpdated }: { provider: ProviderInfo; onUpdated: () => void }) {
  const icon = PROVIDER_ICONS[provider.id] ?? '◆'
  const [updating, setUpdating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err' | 'confirm'; msg: string; pendingForce?: boolean } | null>(null)

  const runUpdate = useCallback(async (force: boolean) => {
    setUpdating(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id, force }),
      })
      const data = await res.json()
      if (res.status === 409 && data.runningSessions?.length) {
        setFeedback({
          kind: 'confirm',
          msg: `Il provider è attivo. Update richiede di stoppare ${data.runningSessions.length} sessioni (${data.runningSessions.join(', ')}). Continuare?`,
          pendingForce: true,
        })
      } else if (data.ok) {
        setFeedback({ kind: 'ok', msg: `aggiornato a ${data.installedVersion || '?'}` })
        onUpdated()
      } else {
        const err = (data.stderr || data.error || 'errore sconosciuto').split('\n').slice(-3).join(' ')
        setFeedback({ kind: 'err', msg: err })
      }
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setUpdating(false)
    }
  }, [provider.id, onUpdated])

  return (
    <div className="border rounded-lg overflow-hidden transition-colors"
      style={{ borderColor: provider.active ? 'rgba(0,232,122,0.4)' : provider.available ? 'var(--color-border-glow)' : 'var(--color-border)', background: 'var(--color-panel)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-[var(--color-white)]">{provider.label}</span>
            {provider.active && (
              <span className="badge text-[9px]" style={{ color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.3)', background: 'rgba(0,232,122,0.08)' }}>
                ● attivo
              </span>
            )}
            <span className="badge text-[9px]" style={{
              color: provider.available ? 'var(--color-green)' : 'var(--color-dim)',
              border: `1px solid ${provider.available ? 'rgba(0,232,122,0.2)' : 'var(--color-border)'}`,
              background: 'transparent',
            }}>
              {provider.available ? 'configurato' : 'non configurato'}
            </span>
            {provider.updateAvailable && (
              <span className="badge text-[9px]" style={{ color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.08)' }}>
                ⚠ update {provider.latestVersion}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-dim)] mt-0.5 font-mono">{provider.id}</p>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3">
        {/* Auth */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--color-dim)]">Autenticazione</span>
          <span className="font-mono" style={{ color: 'var(--color-muted)' }}>
            {provider.authMethod}
            {provider.keySource && <span className="ml-1 text-[9px] text-[var(--color-dim)]">({provider.keySource})</span>}
          </span>
        </div>

        {/* Modello attivo */}
        {provider.activeModel && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--color-dim)]">Modello attivo</span>
            <span className="font-mono text-[var(--color-bright)]">{provider.activeModel}</span>
          </div>
        )}

        {/* Modelli disponibili */}
        <div>
          <p className="text-[10px] text-[var(--color-dim)] mb-1.5">Modelli</p>
          <div className="flex flex-wrap gap-1">
            {provider.models.map(m => (
              <span key={m} className="px-2 py-0.5 rounded text-[9px] font-mono"
                style={{ background: m === provider.activeModel ? 'rgba(0,232,122,0.12)' : 'var(--color-card)', color: m === provider.activeModel ? 'var(--color-green)' : 'var(--color-dim)', border: `1px solid ${m === provider.activeModel ? 'rgba(0,232,122,0.25)' : 'var(--color-border)'}` }}>
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Warning se non configurato */}
        {!provider.available && (
          <p className="text-[10px] text-[var(--color-dim)] px-3 py-2 rounded border border-[var(--color-border)]" style={{ background: 'var(--color-card)' }}>
            Aggiungi la chiave API in <span className="font-mono text-[var(--color-muted)]">jht.config.json</span> o nella variabile d&apos;ambiente corrispondente.
          </p>
        )}

        {/* Version + Update */}
        {provider.updatable && provider.installedVersion && (
          <div className="flex items-center justify-between text-[11px] pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-dim)]">CLI</span>
              <span className="font-mono text-[var(--color-bright)]">{provider.installedVersion}</span>
              {provider.latestVersion && provider.latestVersion !== provider.installedVersion && (
                <span className="text-[10px]" style={{ color: '#f59e0b' }}>→ {provider.latestVersion}</span>
              )}
            </div>
            <button
              onClick={() => runUpdate(false)}
              disabled={updating}
              className="px-3 py-1 rounded text-[10px] font-semibold transition-all"
              style={{
                background: updating ? 'var(--color-border)' : provider.updateAvailable ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: updating ? 'var(--color-dim)' : provider.updateAvailable ? '#f59e0b' : 'var(--color-muted)',
                border: `1px solid ${updating ? 'var(--color-border)' : provider.updateAvailable ? 'rgba(245,158,11,0.3)' : 'var(--color-border)'}`,
                cursor: updating ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {updating ? '…' : provider.updateAvailable ? '↑ Update' : 'Check / Update'}
            </button>
          </div>
        )}

        {feedback && (
          <div className="text-[10px] px-3 py-2 rounded border" style={{
            background: feedback.kind === 'ok' ? 'rgba(0,232,122,0.06)' : feedback.kind === 'err' ? 'rgba(244,67,54,0.06)' : 'rgba(245,158,11,0.06)',
            borderColor: feedback.kind === 'ok' ? 'rgba(0,232,122,0.25)' : feedback.kind === 'err' ? 'rgba(244,67,54,0.25)' : 'rgba(245,158,11,0.25)',
            color: feedback.kind === 'ok' ? 'var(--color-green)' : feedback.kind === 'err' ? '#f44336' : '#f59e0b',
          }}>
            <div>{feedback.msg}</div>
            {feedback.pendingForce && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => runUpdate(true)}
                  disabled={updating}
                  className="px-2 py-1 rounded text-[10px] font-semibold"
                  style={{ background: 'rgba(244,67,54,0.1)', color: '#f44336', border: '1px solid rgba(244,67,54,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Stop team + update
                </button>
                <button
                  onClick={() => setFeedback(null)}
                  className="px-2 py-1 rounded text-[10px] font-semibold"
                  style={{ background: 'transparent', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Annulla
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProvidersPage() {
  const [data, setData] = useState<ProvidersData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/providers').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const available = data?.providers.filter(p => p.available).length ?? 0

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Provider</span>
        </nav>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Provider LLM</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data ? `${available}/${data.providers.length} configurati · provider attivo: ${data.activeProvider}` : 'Caricamento…'}
              {data && !data.configLoaded && <span className="ml-2 text-[var(--color-yellow)]"><span aria-hidden="true">⚠</span> jht.config.json non trovato</span>}
            </p>
          </div>
          <button onClick={fetchData}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-green)'; e.currentTarget.style.color = 'var(--color-green)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
            ↻ aggiorna
          </button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-16" role="status" aria-live="polite"><span className="text-[var(--color-dim)] text-[12px]">Caricamento provider…</span></div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.providers.map((p, i) => <div key={p.id} style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}><ProviderCard provider={p} onUpdated={fetchData} /></div>)}
        </div>
      )}
    </div>
  )
}
