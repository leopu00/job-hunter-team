'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getWorkspace, setWorkspace } from '@/lib/workspace-client'

const supabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function LandingContent() {
  const params = useSearchParams()
  const router = useRouter()
  const authError = params.get('error') === 'auth_failed'
  const wantsLogin = params.get('login') === 'true'
  const wantsChange = params.get('change') === 'true'

  // --- Workspace state (modalita' locale) ---
  const [workspace, setWs] = useState('')
  const [wsStatus, setWsStatus] = useState<{ hasDb: boolean; hasProfile: boolean } | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inputPath, setInputPath] = useState('')

  // Al mount: check se c'e' gia' un workspace nel cookie
  useEffect(() => {
    if (supabaseConfigured) {
      if (!wantsLogin) router.replace('/dashboard')
      return
    }
    const saved = getWorkspace()
    if (saved) {
      // Verifica che sia ancora valido
      fetch('/api/workspace')
        .then(r => r.json())
        .then(data => {
          if (data.path) {
            setWs(data.path)
            setInputPath(data.path)
            setWsStatus({ hasDb: data.hasDb, hasProfile: data.hasProfile })
            // Se ha gia' un DB e l'utente NON ha cliccato "cambia", vai alla dashboard
            if (data.hasDb && !wantsChange) router.replace('/dashboard')
          }
        })
        .catch(() => {})
    }
  }, [router, wantsLogin, wantsChange])

  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const res = await fetch('/api/workspace/browse', { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.folder) {
        setInputPath(data.folder)
        setPendingPath(data.folder)
      }
    } catch { /* ignore */ }
    setBrowsing(false)
  }

  const handleManualPath = () => {
    if (!inputPath.trim()) return
    setPendingPath(inputPath.trim())
  }

  const handleConfirm = async () => {
    if (!pendingPath) return
    setConfirming(true)
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pendingPath }),
      })
      const data = await res.json()
      if (!data.ok) { setConfirming(false); return }
      setWorkspace(pendingPath)
      setWs(pendingPath)
      if (!data.hasDb) {
        await fetch('/api/workspace/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pendingPath }),
        })
      }
      window.location.href = '/dashboard'
    } catch { /* ignore */ }
    setConfirming(false)
  }

  const handleDismiss = () => setPendingPath(null)

  const handleEnter = () => {
    router.push('/dashboard')
  }

  // --- Cloud mode: login Google ---
  if (supabaseConfigured || wantsLogin) {
    const handleGoogleLogin = async () => {
      const supabase = createClient()
      const origin = window.location.origin
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback`,
          queryParams: { prompt: 'select_account' },
        },
      })
    }

    return (
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex items-center justify-center px-5">
        <div className="w-full max-w-md" style={{ animation: 'fade-in 0.5s ease both' }}>
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">sistema attivo</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
              Job Hunter<br /><span className="text-[var(--color-green)]">Team</span>
            </h1>
            <p className="text-[var(--color-muted)] text-[12px] leading-relaxed max-w-xs mx-auto">
              Sistema multi-agente per ricerca e candidatura automatizzata.
            </p>
          </div>
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">auth</span>
              <span className="text-[var(--color-dim)] text-[10px]">/</span>
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">accesso</span>
            </div>
            <div className="px-6 py-8 flex flex-col gap-4">
              {authError && (
                <div className="px-3 py-2 rounded border border-[var(--color-red)] text-[11px]" style={{ color: 'var(--color-red)' }}>
                  Autenticazione fallita. Verifica di usare un account autorizzato.
                </div>
              )}
              <p className="text-[var(--color-muted)] text-[11px]">Accesso riservato ai membri del team. Usa il tuo account Google.</p>
              <button onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-bright)] text-[12px] font-semibold tracking-wider hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-all duration-150 cursor-pointer">
                <GoogleIcon />
                Login with Google
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // --- Modalita' locale: workspace selector ---
  const hasWorkspace = workspace.length > 0

  return (
    <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-lg" style={{ animation: 'fade-in 0.5s ease both' }}>

        {/* Header */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">modalita locale</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
            Job Hunter<br /><span className="text-[var(--color-green)]">Team</span>
          </h1>
          <p className="text-[var(--color-muted)] text-[12px] leading-relaxed max-w-xs mx-auto">
            Seleziona la tua cartella di lavoro per iniziare.
            I tuoi dati restano sul tuo computer.
          </p>
        </div>

        {/* Workspace selector card */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">setup</span>
            <span className="text-[var(--color-dim)] text-[10px]">/</span>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">workspace</span>
          </div>

          <div className="px-6 py-6 flex flex-col gap-4">

            {/* Browse button + manual input */}
            <div className="flex gap-2">
              <button onClick={handleBrowse} disabled={browsing}
                className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all flex-shrink-0"
                style={{
                  background: browsing ? 'var(--color-border)' : 'var(--color-green)',
                  color: browsing ? 'var(--color-dim)' : '#000',
                  cursor: browsing ? 'not-allowed' : 'pointer',
                }}>
                {browsing ? 'Seleziona...' : 'Sfoglia'}
              </button>
              <input
                type="text"
                value={inputPath}
                onChange={e => setInputPath(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualPath()}
                placeholder="/percorso/alla/cartella"
                className="flex-1 px-3 py-2 rounded-lg text-[12px] bg-[var(--color-card)] border border-[var(--color-border)] outline-none font-mono"
                style={{ color: 'var(--color-bright)' }}
              />
            </div>

            {/* Actions */}
            {hasWorkspace && wsStatus?.hasDb && (
              <button onClick={handleEnter}
                className="w-full px-5 py-3 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                style={{ background: 'var(--color-green)', color: '#000', cursor: 'pointer' }}>
                Entra nella dashboard
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-[var(--color-dim)]">
          v0.1.0-alpha · Job Hunter Team
        </p>
      </div>

      {/* Modal conferma workspace */}
      {pendingPath && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 px-5"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', animation: 'fade-in 0.15s ease both' }}
        >
          <div className="w-full max-w-md bg-[var(--color-panel)] border border-[var(--color-border)] rounded-xl p-6" style={{ animation: 'fade-in 0.2s ease both' }}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h2 className="text-[14px] font-bold text-[var(--color-white)]">Conferma cartella di lavoro</h2>
              <button onClick={handleDismiss} className="text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors text-[20px] leading-none" style={{ cursor: 'pointer' }}>×</button>
            </div>
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-4">
              Tutti i dati (database, PDF, documenti) e gli agenti lavoreranno esclusivamente in questa cartella:
            </p>
            <div className="font-mono text-[11px] text-[var(--color-bright)] bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 mb-6 break-all">
              {pendingPath}
            </div>
            <div className="flex gap-3">
              <button onClick={handleDismiss}
                className="flex-1 px-4 py-2.5 rounded-lg text-[12px] font-semibold border border-[var(--color-border)] transition-colors hover:border-[var(--color-muted)]"
                style={{ color: 'var(--color-muted)', cursor: 'pointer' }}>
                Annulla
              </button>
              <button onClick={handleConfirm} disabled={confirming}
                className="flex-1 px-4 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                style={{
                  background: confirming ? 'var(--color-border)' : 'var(--color-green)',
                  color: confirming ? 'var(--color-dim)' : '#000',
                  cursor: confirming ? 'not-allowed' : 'pointer',
                }}>
                {confirming ? 'Attendi…' : 'OK, usa questa cartella'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function LandingPage() {
  return (
    <Suspense>
      <LandingContent />
    </Suspense>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
