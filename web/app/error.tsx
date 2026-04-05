'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[JHT] errore pagina:', error)
  }, [error])

  return (
    <main role="alert" className="min-h-screen flex items-center justify-center px-5" style={{ position: 'relative', zIndex: 1, animation: 'fade-in 0.35s ease both' }}>
      <div className="text-center max-w-md">

        {/* Error code */}
        <div className="mb-6">
          <p className="text-[80px] font-bold leading-none tracking-tighter" style={{ color: 'var(--color-border)', fontVariantNumeric: 'tabular-nums' }}>
            ERR
          </p>
          <div className="mt-[-12px] flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-red)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--color-red)' }}>errore di runtime</span>
          </div>
        </div>

        {/* Message */}
        <h1 className="text-lg font-bold mb-2" style={{ color: 'var(--color-white)' }}>
          Qualcosa è andato storto
        </h1>
        <p className="text-[12px] mb-6 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {error.message || 'Errore imprevisto. Riprova o torna alla dashboard.'}
        </p>

        {error.digest && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg mb-6" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--color-dim)' }}>digest</span>
            <code className="text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>{error.digest}</code>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold transition-all cursor-pointer border-0"
            style={{ background: 'var(--color-green)', color: '#000' }}
          >
            Riprova
          </button>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="px-5 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
          >
            Dashboard →
          </button>
        </div>
      </div>
    </main>
  )
}
