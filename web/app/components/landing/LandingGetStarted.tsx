'use client'

import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

const STEPS = [
  { n: '1', titleKey: 'gs_0_title', descKey: 'gs_0_desc', icon: DownloadIcon },
  { n: '2', titleKey: 'gs_1_title', descKey: 'gs_1_desc', icon: ProfileIcon },
  { n: '3', titleKey: 'gs_2_title', descKey: 'gs_2_desc', icon: RocketIcon },
] as const

export default function LandingGetStarted() {
  const { t } = useLandingI18n()

  return (
    <section aria-label="Inizia" id="start" className="px-6 py-24 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-24" style={{ background: 'linear-gradient(180deg, transparent, var(--color-border))' }} />

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-3 block">
            {t('gs_label')}
          </span>
          <h2 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight">
            {t('gs_title')}
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <div key={i} className="relative group">
              <div className="border border-[var(--color-border)] hover:border-[var(--color-border-glow)] rounded-xl p-6 h-full transition-all duration-200"
                style={{ background: 'var(--color-panel)', animation: `fade-in 0.4s ease ${i * 0.12}s both` }}>
                {/* Step number + icon */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-[var(--color-border)] flex-shrink-0"
                    style={{ background: 'var(--color-card)' }}>
                    <span className="text-[var(--color-green)] text-[13px] font-bold">{s.n}</span>
                  </div>
                  <div className="text-[var(--color-base)]">
                    <s.icon />
                  </div>
                </div>

                <h3 className="text-[14px] font-bold text-[var(--color-white)] mb-2">
                  {t(s.titleKey)}
                </h3>
                <p className="text-[12px] text-[var(--color-bright)] leading-relaxed">
                  {t(s.descKey)}
                </p>
              </div>

              {/* Arrow connector between cards (desktop) */}
              {i < STEPS.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 text-[var(--color-border)] text-[14px]">
                  →
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA button */}
        <div className="mt-10 text-center">
          <Link href="/download"
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-lg text-[13px] font-bold tracking-wide transition-all no-underline hover:no-underline"
            style={{
              background: 'var(--color-green)',
              color: '#000',
            }}>
            <DownloadIcon />
            {t('gs_0_title')}
          </Link>
        </div>
      </div>
    </section>
  )
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function RocketIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}
