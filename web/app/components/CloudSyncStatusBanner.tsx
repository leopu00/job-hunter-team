'use client'

import { useEffect, useState } from 'react'

interface Counts { positions: number; scores: number; applications: number }

interface SyncStatus {
  local: boolean
  logged_in: boolean
  last_sync: { at: string } | null
  local_counts: Counts
  cloud_counts: Counts
  in_sync: boolean
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return 'in futuro'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return sec <= 5 ? 'pochi secondi fa' : `${sec} sec fa`
  const min = Math.floor(sec / 60)
  if (min < 60) return min === 1 ? '1 min fa' : `${min} min fa`
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr === 1 ? '1 ora fa' : `${hr} ore fa`
  const days = Math.floor(hr / 24)
  return days === 1 ? '1 giorno fa' : `${days} giorni fa`
}

/**
 * Banner compatto stato cloud-sync. Visualizza in una sola riga:
 * badge in/out of sync, ultimo sync relativo, count per tabella, bottone Sync.
 * Nascosto se l'utente non è loggato (non ha senso mostrare lo stato).
 */
export default function CloudSyncStatusBanner() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/local/sync/status')
      if (!res.ok) return
      setStatus(await res.json())
    } catch {
      /* offline: lascia ultimo */
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  async function handleSync() {
    setError(null)
    setSyncing(true)
    try {
      const res = await fetch('/api/local/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore di rete')
    } finally {
      setSyncing(false)
    }
  }

  // Nasconde se non loggato (banner ha senso solo per utenti che possono syncare).
  if (!status || !status.logged_in) return null

  const inSync = status.in_sync
  const accent = inSync ? 'var(--color-green)' : 'var(--color-yellow, #d4a85a)'

  return (
    <div
      className="mb-5 px-4 py-2.5 border rounded-lg flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]"
      style={{ borderColor: 'var(--color-border)', background: 'rgba(0,0,0,0.15)' }}
    >
      <span
        className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
        style={{ color: accent, border: `1px solid ${accent}` }}
      >
        {inSync ? '✓ Cloud sync' : '◐ Da sincronizzare'}
      </span>

      <span className="text-[var(--color-dim)] whitespace-nowrap">
        {status.last_sync ? (
          <>Ultimo: <span style={{ color: 'var(--color-bright)' }}>{formatRelativeTime(status.last_sync.at)}</span></>
        ) : (
          <>Mai sincronizzato</>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-dim)] font-mono">
        {(['positions', 'scores', 'applications'] as const).map((t) => {
          const local = status.local_counts[t]
          const cloud = status.cloud_counts[t]
          const eq = local === cloud
          return (
            <span key={t} style={{ color: eq ? 'var(--color-dim)' : 'var(--color-yellow, #d4a85a)' }}>
              {t}: {local}/{cloud}
            </span>
          )
        })}
      </span>

      <button
        onClick={handleSync}
        disabled={syncing}
        className="ml-auto px-3 py-1 text-[10px] font-semibold border rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: 'var(--color-green)',
          borderColor: 'var(--color-green)',
          background: 'transparent',
        }}
      >
        {syncing ? 'Sync…' : 'Sync now'}
      </button>

      {error && (
        <span className="w-full text-[10px]" style={{ color: 'var(--color-red)' }}>
          {error}
        </span>
      )}
    </div>
  )
}
