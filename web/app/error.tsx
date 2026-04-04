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
    <main className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-md flex flex-col items-center gap-5 text-center">
        <p className="text-[9px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--color-red)' }}>
          errore
        </p>
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
          Qualcosa è andato storto
        </h1>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {error.message || 'Errore imprevisto.'}
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono px-3 py-1 rounded" style={{ color: 'var(--color-dim)', background: 'var(--color-panel)' }}>
            {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-5 py-2 rounded text-[11px] font-semibold transition-colors cursor-pointer"
          style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}
        >
          Riprova
        </button>
      </div>
    </main>
  )
}
