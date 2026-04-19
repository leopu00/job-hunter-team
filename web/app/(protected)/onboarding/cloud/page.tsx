'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Step finale dell'onboarding: scelta sync cloud o locale. NON è una pagina
// di login — è una pagina di decisione. Il login (Google/GitHub) è solo una
// delle due strade, l'altra è "continua in locale" dove tutto resta su disco.
// Il routing verso qui è innescato dal bottone "Vai alla dashboard" di
// /onboarding una volta che il profilo è sbloccato.
export default function OnboardingCloudChoice() {
  const router = useRouter()

  return (
    <div
      className="flex flex-col items-center justify-center px-5"
      style={{ height: 'calc(100vh / var(--zoom))', animation: 'fade-in 0.35s ease both' }}
    >
      <div className="max-w-md w-full flex flex-col items-center text-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">
          Sincronizzazione <span className="text-[var(--color-green)]">cloud</span>
        </h1>
        <p className="text-[11px] text-[var(--color-muted)] leading-relaxed max-w-sm">
          Collega un account per accedere al profilo da altri dispositivi. Facoltativo.
        </p>

        <div className="flex flex-col gap-2 w-full mt-4">
          <Link
            href="/?login=true"
            className="w-full px-4 py-3 rounded-lg text-[12px] font-bold tracking-wide text-center transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-green)', color: '#000' }}
          >
            Collega account
          </Link>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full px-4 py-3 rounded-lg text-[11px] font-semibold tracking-wide text-center cursor-pointer transition-colors hover:bg-[var(--color-row)]"
            style={{
              background: 'var(--color-card)',
              color: 'var(--color-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            Continua senza
          </button>
        </div>
      </div>
    </div>
  )
}
