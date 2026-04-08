'use client'

import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

const CAPTAIN_AGENT = { emoji: '👨‍✈️', name: 'Capitano' }

const PIPELINE_AGENTS = [
  { emoji: '🕵️', name: 'Scout' },
  { emoji: '👨‍🔬', name: 'Analista' },
  { emoji: '👨‍💻', name: 'Scorer' },
  { emoji: '👨‍🏫', name: 'Scrittore' },
  { emoji: '👨‍⚖️', name: 'Critico' },
  { emoji: '💂', name: 'Sentinella' },
]

export default function LandingHero() {
  const { t } = useLandingI18n()

  return (
    <section aria-label="Hero" className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-6xl mx-auto text-center" style={{ animation: 'fade-in 0.6s ease both' }}>
        <h1 className="w-full text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Job Hunter Team
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-muted)] leading-relaxed max-w-xl mx-auto mb-4">
          Una squadra di agenti AI per la ricerca lavoro.
        </p>

        <div className="inline-flex items-center mb-10 px-3 py-1.5 rounded-full border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">BETA</span>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/download"
            className="px-6 py-3 rounded text-[12px] font-bold tracking-wider no-underline transition-all"
            style={{ background: 'var(--color-green)', color: '#060608', boxShadow: '0 0 20px rgba(0,232,122,0.25)' }}
          >
            {t('hero_cta')}
          </Link>
          <a
            href="#features"
            className="px-6 py-3 rounded text-[12px] font-semibold tracking-wider no-underline transition-all border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)] hover:text-[var(--color-bright)]"
          >
            {t('hero_cta2')}
          </a>
        </div>
      </div>

      <div
        className="relative z-10 w-full max-w-6xl mt-14 px-2"
        style={{ animation: 'fade-in 0.8s ease 0.2s both' }}
      >
        <div className="flex justify-center mb-8">
          <span className="inline-flex flex-col items-center gap-2 shrink-0">
            <span className="text-3xl md:text-4xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
            <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>
          </span>
        </div>

        <div className="flex items-start justify-start md:justify-center gap-x-6 md:gap-x-8 gap-y-4 overflow-x-auto pb-3">
          {PIPELINE_AGENTS.map((agent) => (
            <span key={agent.name} className="inline-flex flex-col items-center gap-2 shrink-0 min-w-[72px]">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{agent.emoji}</span>
              <span className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center">{agent.name}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
