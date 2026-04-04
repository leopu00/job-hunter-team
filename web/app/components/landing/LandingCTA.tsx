'use client'

import Link from 'next/link'

export default function LandingCTA() {
  return (
    <section id="cta" className="px-6 py-24 relative">
      <div
        className="max-w-3xl mx-auto text-center rounded-xl p-10 md:p-16 border border-[var(--color-border)] relative overflow-hidden"
        style={{ background: 'var(--color-panel)' }}
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,232,122,0.06) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10">
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--color-white)] tracking-tight mb-4">
            Pronto a rivoluzionare<br />la tua ricerca lavoro?
          </h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-md mx-auto mb-8">
            Smetti di inviare candidature generiche. Lascia che un team di agenti AI
            lavori per te, in modo intelligente e personalizzato.
          </p>
          <Link
            href="/?login=true"
            className="inline-block px-8 py-3.5 rounded text-[13px] font-bold tracking-wider no-underline transition-all"
            style={{
              background: 'var(--color-green)',
              color: '#060608',
              boxShadow: '0 0 30px rgba(0,232,122,0.3)',
            }}
          >
            Inizia ora — è gratis
          </Link>
          <p className="mt-4 text-[10px] text-[var(--color-dim)]">
            Nessuna carta di credito richiesta · Beta pubblica
          </p>
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="px-6 py-8 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
          <span className="text-[11px] font-bold tracking-widest text-[var(--color-muted)]">JHT</span>
          <span className="text-[10px] text-[var(--color-dim)]">· Job Hunter Team</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/leopu00/job-hunter-team"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors no-underline"
          >
            GitHub
          </a>
          <span className="text-[10px] text-[var(--color-dim)]">v1.0.0-beta</span>
        </div>
      </div>
    </footer>
  )
}
