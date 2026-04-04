'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[JHT] errore area protetta:', error)
  }, [error])

  return (
    <div className="flex items-center justify-center py-20" style={{ animation: 'fade-in 0.3s ease both' }}>
      <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.25)' }}>
          <span className="text-[16px]" style={{ color: 'var(--color-red)' }}>!</span>
        </div>
        <h2 className="text-[16px] font-bold" style={{ color: 'var(--color-white)' }}>
          Errore nel caricamento
        </h2>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {error.message || 'Si e verificato un errore imprevisto.'}
        </p>
        {error.digest && (
          <p className="text-[9px] font-mono px-3 py-1 rounded" style={{ color: 'var(--color-dim)', background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            {error.digest}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
            style={{ background: 'var(--color-green)', color: '#000' }}
          >
            Riprova
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors no-underline"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          >
            Torna alla Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
