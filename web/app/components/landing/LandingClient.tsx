'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LandingNav from './LandingNav'
import LandingHero from './LandingHero'
import { LandingI18nProvider } from './LandingI18n'
import { LandingFooter } from './LandingCTA'

type Props = {
  wantsLogin: boolean
  authError: boolean
}

export default function LandingClient({ wantsLogin, authError }: Props) {
  return (
    <LandingI18nProvider>
      {wantsLogin ? (
        <LoginPage authError={authError} />
      ) : (
        <>
          <main style={{ position: 'relative', zIndex: 1 }}>
            <LandingNav />
            <LandingHero />
          </main>
          <LandingFooter />
        </>
      )}
    </LandingI18nProvider>
  )
}

function LoginPage({ authError }: { authError: boolean }) {
  const [configError, setConfigError] = useState(false)

  const handleGoogleLogin = async () => {
    setConfigError(false)
    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
    const redirectBase = appUrl || window.location.origin
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${redirectBase}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })

    if (error) setConfigError(true)
  }

  const handleGitHubLogin = async () => {
    setConfigError(false)
    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
    const redirectBase = appUrl || window.location.origin
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${redirectBase}/auth/callback`,
      },
    })

    if (error) setConfigError(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-sm" style={{ animation: 'fade-in 0.5s ease both' }}>
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-xl font-medium tracking-tight text-[var(--color-white)] mb-1">
            Job Hunter <span className="text-[var(--color-green)]">Team</span>
          </h1>
          <p className="text-[var(--color-dim)] text-[11px]">
            Sign in to save your progress
          </p>
        </div>

        {/* Errori */}
        {authError && (
          <div className="mb-4 px-3 py-2 border border-[var(--color-red)] text-[11px]" style={{ color: 'var(--color-red)' }}>
            Authentication failed.
          </div>
        )}
        {configError && (
          <div className="mb-4 px-3 py-2 border border-[var(--color-yellow)] text-[11px]" style={{ color: 'var(--color-yellow)' }}>
            Configuration missing.
          </div>
        )}

        {/* Pulsanti provider */}
        <div className="space-y-2">
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-bright)] text-[12px] font-medium hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-all duration-150 cursor-pointer"
          >
            <GoogleIcon />
            Login with Google
          </button>
          <button
            onClick={handleGitHubLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-bright)] text-[12px] font-medium hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-all duration-150 cursor-pointer"
          >
            <GitHubIcon />
            Login with GitHub
          </button>
        </div>

        {/* Torna indietro */}
        <div className="mt-4 text-center">
          <BackButton />
        </div>
      </div>
    </main>
  )
}

function BackButton() {
  const router = useRouter()

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <button
      onClick={handleBack}
      className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
    >
      Back
    </button>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  )
}
