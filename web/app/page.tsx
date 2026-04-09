'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LandingNav from './components/landing/LandingNav'
import LandingHero from './components/landing/LandingHero'
import { LandingI18nProvider } from './components/landing/LandingI18n'
import JsonLd from './components/landing/JsonLd'

function PageContent() {
  const params = useSearchParams()
  const authError = params.get('error') === 'auth_failed'
  const wantsLogin = params.get('login') === 'true'

  return (
    <LandingI18nProvider>
      {wantsLogin ? (
        <LoginPage authError={authError} />
      ) : (
        <>
          <JsonLd />
          <main style={{ position: 'relative', zIndex: 1 }}>
            {/* LandingNav nascosto temporaneamente - pagine incomplete */}
            {/* <LandingNav /> */}
            <LandingHero />
          </main>
        </>
      )}
    </LandingI18nProvider>
  )
}

export default function LandingPage() {
  return (
    <Suspense>
      <PageContent />
    </Suspense>
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

        {/* Pulsante Google */}
        <button 
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-bright)] text-[12px] font-medium hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-all duration-150 cursor-pointer"
        >
          <GoogleIcon />
          Login with Google
        </button>

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
