'use client'

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ position: 'relative', zIndex: 1, animation: 'fade-in 0.35s ease both' }}>
      <div className="text-center max-w-md">

        {/* Codice errore */}
        <div className="mb-6">
          <h1 className="text-[120px] font-bold leading-none tracking-tighter" style={{ color: 'var(--color-border)', fontVariantNumeric: 'tabular-nums' }}>
            404
          </h1>
          <div className="mt-[-16px] flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full" aria-hidden="true" style={{ background: 'var(--color-red)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--color-red)' }}>pagina non trovata</span>
          </div>
        </div>

        {/* Messaggio */}
        <p className="text-[13px] mb-8 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          La risorsa richiesta non esiste o è stata spostata.
        </p>

        {/* Azioni */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link href="/dashboard"
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold no-underline transition-all"
            style={{ background: 'var(--color-green)', color: '#000' }}>
            Dashboard
          </Link>
          <button onClick={() => window.history.back()}
            className="px-5 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-muted)'; e.currentTarget.style.color = 'var(--color-bright)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
            ← indietro
          </button>
        </div>

        {/* Path corrente */}
        <p className="mt-8 text-[9px] font-mono" style={{ color: 'var(--color-dim)' }}>
          {typeof window !== 'undefined' ? window.location.pathname : ''}
        </p>
      </div>
    </div>
  )
}
