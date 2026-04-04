'use client'

import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

export default function LandingCTA() {
  const { t } = useLandingI18n()

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
            {t('cta_title_1')}<br />{t('cta_title_2')}
          </h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-md mx-auto mb-8">
            {t('cta_desc')}
          </p>
          <Link
            href="/download"
            className="inline-block px-8 py-3.5 rounded text-[13px] font-bold tracking-wider no-underline transition-all"
            style={{
              background: 'var(--color-green)',
              color: '#060608',
              boxShadow: '0 0 30px rgba(0,232,122,0.3)',
            }}
          >
            {t('cta_button')}
          </Link>
          <p className="mt-4 text-[10px] text-[var(--color-dim)]">
            {t('cta_note')}
          </p>
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  const linkClass = 'text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors no-underline block py-0.5'

  return (
    <footer className="px-6 pt-12 pb-8 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto">
        {/* Columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
              <span className="text-[11px] font-bold tracking-widest text-[var(--color-muted)]">JHT</span>
            </div>
            <p className="text-[10px] text-[var(--color-dim)] leading-relaxed">
              Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.
            </p>
          </div>

          {/* Prodotto */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">Prodotto</h4>
            <Link href="/download" className={linkClass}>Download</Link>
            <Link href="/pricing" className={linkClass}>Pricing</Link>
            <Link href="/demo" className={linkClass}>Demo</Link>
            <Link href="/changelog" className={linkClass}>Changelog</Link>
          </div>

          {/* Risorse */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">Risorse</h4>
            <Link href="/guide" className={linkClass}>Guida</Link>
            <Link href="/faq" className={linkClass}>FAQ</Link>
            <Link href="/docs" className={linkClass}>Documentazione</Link>
            <Link href="/about" className={linkClass}>Chi siamo</Link>
            <a href="https://github.com/leopu00/job-hunter-team" target="_blank" rel="noreferrer" className={linkClass}>GitHub</a>
          </div>

          {/* Contatti */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">Contatti</h4>
            <Link href="/privacy" className={linkClass}>Privacy Policy</Link>
            <a href="https://github.com/leopu00/job-hunter-team/issues" target="_blank" rel="noreferrer" className={linkClass}>Segnala un bug</a>
            <a href="https://github.com/leopu00/job-hunter-team/discussions" target="_blank" rel="noreferrer" className={linkClass}>Discussioni</a>
            <Link href="/privacy" className={linkClass}>Privacy</Link>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-[var(--color-border)] flex flex-col md:flex-row items-center justify-between gap-3">
          <span className="text-[9px] text-[var(--color-dim)]">
            &copy; {new Date().getFullYear()} Job Hunter Team &mdash; Open Source under MIT License
          </span>
          <span className="text-[9px] text-[var(--color-dim)]">v1.0.0-beta</span>
        </div>
      </div>
    </footer>
  )
}
