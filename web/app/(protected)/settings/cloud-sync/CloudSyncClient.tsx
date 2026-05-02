'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface LocalHealth {
  local: boolean
  logged_in: boolean
  user_email: string | null
  user_id: string | null
}

interface SyncResult {
  empty: boolean
  positions: { upserted: number }
  scores: { upserted: number }
  applications: { upserted: number }
  payload?: { positions: number; scores: number; applications: number }
}

type SyncState =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'success'; result: SyncResult; at: number }
  | { status: 'error'; message: string }

interface Counts { positions: number; scores: number; applications: number }

interface SyncStatus {
  local: boolean
  logged_in: boolean
  last_sync: {
    at: string
    summary: {
      positions: { upserted: number; payload: number }
      scores: { upserted: number; payload: number }
      applications: { upserted: number; payload: number }
    }
  } | null
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

export default function CloudSyncClient() {
  const [health, setHealth] = useState<LocalHealth | null>(null)
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle' })
  const [authError, setAuthError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)

  async function refreshHealth() {
    try {
      const res = await fetch('/api/local/health')
      const data: LocalHealth = await res.json()
      setHealth(data)
    } catch {
      setHealth({ local: false, logged_in: false, user_email: null, user_id: null })
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/local/sync/status')
      if (!res.ok) return
      const data: SyncStatus = await res.json()
      setStatus(data)
    } catch {
      /* offline o errore: lascia ultimo stato */
    }
  }

  useEffect(() => {
    refreshHealth()
    refreshStatus()
    // Polling stato ogni 30s mentre la pagina è visibile (no costo se offscreen).
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshStatus()
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  async function handleLogin() {
    setAuthError(null)
    const supabase = createClient()
    const redirectBase = window.location.origin
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${redirectBase}/auth/callback?next=/settings/cloud-sync`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) setAuthError(error.message)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setSyncState({ status: 'idle' })
    await refreshHealth()
  }

  async function handleSync() {
    setSyncState({ status: 'syncing' })
    try {
      const res = await fetch('/api/local/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncState({ status: 'error', message: data.error || `HTTP ${res.status}` })
        return
      }
      setSyncState({ status: 'success', result: data as SyncResult, at: Date.now() })
      // Aggiorna stato dopo successo per riflettere "ultimo sync = ora".
      await refreshStatus()
    } catch (err) {
      setSyncState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Errore di rete',
      })
    }
  }

  return (
    <div className="min-h-screen px-5 py-8 max-w-2xl mx-auto">
      <header className="mb-8">
        <h1 className="text-xl font-medium tracking-tight text-[var(--color-white)] mb-1">
          Cloud Sync
        </h1>
        <p className="text-[var(--color-dim)] text-[11px]">
          Sincronizza i tuoi dati locali con il cloud (opt-in). I dati restano sul tuo PC
          finché non clicchi sincronizza.
        </p>
      </header>

      {!health && (
        <div className="text-[11px] text-[var(--color-dim)]">Caricamento…</div>
      )}

      {health && !health.local && (
        <div className="p-4 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-[11px] text-[var(--color-dim)]">
            Database locale non trovato. Avvia il team almeno una volta per generare
            <code className="text-[var(--color-bright)]"> ~/.jht/jobs.db</code>, poi torna qui.
          </div>
        </div>
      )}

      {health && health.local && !health.logged_in && (
        <div className="p-5 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-[12px] text-[var(--color-bright)] font-medium mb-1">
            Accedi per sincronizzare
          </div>
          <div className="text-[11px] text-[var(--color-dim)] mb-4">
            Login con Google per associare il sync al tuo account.
            I dati vanno solo nel tuo spazio cloud, protetti da Row Level Security.
          </div>
          <button
            onClick={handleLogin}
            className="px-4 py-2 border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-bright)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
          >
            Login con Google
          </button>
          {authError && (
            <div className="mt-3 text-[11px]" style={{ color: 'var(--color-red)' }}>
              {authError}
            </div>
          )}
        </div>
      )}

      {health && health.local && health.logged_in && (
        <div className="p-5 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="text-[12px] text-[var(--color-bright)] font-medium truncate">
                {health.user_email}
              </div>
              <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                Connesso al cloud
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 border border-[var(--color-border)] text-[10px] text-[var(--color-dim)] hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer"
            >
              Logout
            </button>
          </div>

          {/* Stato sync — ultimo sync, count locale vs cloud, badge in/out of sync */}
          {status && (
            <div className="mb-4 p-3 border border-[var(--color-border)] bg-[rgba(0,0,0,0.2)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-dim)]">Stato</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{
                    color: status.in_sync ? 'var(--color-green)' : 'var(--color-yellow, #d4a85a)',
                    border: `1px solid ${status.in_sync ? 'var(--color-green)' : 'var(--color-yellow, #d4a85a)'}`,
                  }}
                >
                  {status.in_sync ? '✓ Sincronizzato' : 'Da sincronizzare'}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-bright)] mb-1">
                {status.last_sync ? (
                  <>Ultimo sync: <span className="text-[var(--color-dim)]">{formatRelativeTime(status.last_sync.at)}</span></>
                ) : (
                  <span className="text-[var(--color-dim)]">Mai sincronizzato</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] mt-2">
                {(['positions', 'scores', 'applications'] as const).map((t) => {
                  const local = status.local_counts[t]
                  const cloud = status.cloud_counts[t]
                  const eq = local === cloud
                  return (
                    <div key={t} className="flex flex-col">
                      <span className="text-[var(--color-dim)] uppercase tracking-wider">{t}</span>
                      <span style={{ color: eq ? 'var(--color-bright)' : 'var(--color-yellow, #d4a85a)' }}>
                        {local} / {cloud} cloud
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncState.status === 'syncing'}
            className="w-full px-4 py-3 border border-[var(--color-green)] text-[12px] font-medium text-[var(--color-green)] hover:bg-[var(--color-green)] hover:text-[var(--color-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncState.status === 'syncing' ? 'Sincronizzando…' : 'Sync now'}
          </button>

          {syncState.status === 'success' && (
            <div className="mt-3 text-[11px] text-[var(--color-green)]">
              {syncState.result.empty ? (
                <>Nessun dato locale da sincronizzare.</>
              ) : (
                <>
                  ✓ Sincronizzato — positions {syncState.result.positions.upserted}
                  {syncState.result.payload ? `/${syncState.result.payload.positions}` : ''}
                  {' · '}scores {syncState.result.scores.upserted}
                  {syncState.result.payload ? `/${syncState.result.payload.scores}` : ''}
                  {' · '}applications {syncState.result.applications.upserted}
                  {syncState.result.payload ? `/${syncState.result.payload.applications}` : ''}
                </>
              )}
            </div>
          )}

          {syncState.status === 'error' && (
            <div className="mt-3 text-[11px]" style={{ color: 'var(--color-red)' }}>
              {syncState.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
