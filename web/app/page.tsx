'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function LandingContent() {
  const params = useSearchParams()
  const router = useRouter()
  const authError = params.get('error') === 'auth_failed'

  // Se Supabase non è configurato, vai direttamente alla dashboard
  useEffect(() => {
    if (!supabaseConfigured) {
      router.replace('/dashboard')
    }
  }, [router])

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
    <main
      style={{ position: 'relative', zIndex: 1 }}
      className="min-h-screen flex items-center justify-center px-5"
    >
      <div className="w-full max-w-md" style={{ animation: 'fade-in 0.5s ease both' }}>

        {/* Logo / Brand */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <div
              className="w-2.5 h-2.5 rounded-full bg-[var(--color-green)]"
              style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
            />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
              sistema attivo
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
            Job Hunter<br />
            <span className="text-[var(--color-green)]">Team</span>
          </h1>

          <p className="text-[var(--color-muted)] text-[12px] leading-relaxed max-w-xs mx-auto">
            Sistema multi-agente per ricerca e candidatura automatizzata.
            Accedi per monitorare la tua pipeline.
          </p>
        </div>

        {/* Login card */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
          {/* Card header */}
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
              auth
            </span>
            <span className="text-[var(--color-dim)] text-[10px]">/</span>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
              accesso
            </span>
          </div>

          {/* Card body */}
          <div className="px-6 py-8 flex flex-col gap-4">
            {authError && (
              <div className="px-3 py-2 rounded border border-[var(--color-red)] bg-[var(--color-red)10] text-[11px]" style={{ color: 'var(--color-red)' }}>
                Autenticazione fallita. Verifica di usare un account autorizzato.
              </div>
            )}
            <p className="text-[var(--color-muted)] text-[11px]">
              Accesso riservato ai membri del team. Usa il tuo account Google.
            </p>

            {/* Google Login Button */}
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-bright)] text-[12px] font-semibold tracking-wider hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-all duration-150 cursor-pointer group"
            >
              <GoogleIcon />
              Login with Google
            </button>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-[var(--color-border)]" />
              <span className="text-[10px] text-[var(--color-dim)]">OAuth 2.0 via Supabase</span>
              <div className="flex-1 h-px bg-[var(--color-border)]" />
            </div>

            <p className="text-[10px] text-[var(--color-dim)] text-center leading-relaxed">
              Verrai reindirizzato a Google per l&apos;autenticazione.<br />
              Nessuna password memorizzata.
            </p>
          </div>
        </div>

        {/* Pipeline stats strip */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          {[
            { label: 'scout',    color: 'var(--color-blue)' },
            { label: 'analisi',  color: 'var(--color-purple)' },
            { label: 'scoring',  color: 'var(--color-yellow)' },
            { label: 'scrittura', color: 'var(--color-orange)' },
          ].map(({ label, color }) => (
            <div
              key={label}
              className="border border-[var(--color-border)] rounded bg-[var(--color-panel)] px-3 py-2 text-center"
            >
              <div
                className="w-1.5 h-1.5 rounded-full mx-auto mb-1.5"
                style={{ background: color, boxShadow: `0 0 4px ${color}` }}
              />
              <span className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
                {label}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-[10px] text-[var(--color-dim)]">
          v0.1.0-alpha · Job Hunter Team
        </p>
      </div>
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
