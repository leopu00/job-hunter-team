'use client'

import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

const CAPTAIN_AGENT = { emoji: '👨‍✈️', name: 'Capitano' }
const SENTINEL_AGENT = { emoji: '💂', name: 'Sentinella' }

const PIPELINE_AGENTS = [
  { emoji: '🕵️', name: 'Scout' },
  { emoji: '👨‍🔬', name: 'Analista' },
  { emoji: '👨‍💻', name: 'Scorer' },
  { emoji: '👨‍🏫', name: 'Scrittore' },
  { emoji: '👨‍⚖️', name: 'Critico' },
]

export default function LandingHero() {
  const { t } = useLandingI18n()

  return (
    <section aria-label="Hero" className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-6xl mx-auto text-center" style={{ animation: 'fade-in 0.6s ease both' }}>
        <h1 className="w-full text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Job Hunter Team
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-base)] leading-relaxed max-w-xl mx-auto mb-4">
          Una squadra di agenti AI per la ricerca lavoro.
        </p>

        <div className="inline-flex items-center mb-10 px-3 py-1.5 rounded-full border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">BETA</span>
        </div>

      </div>

      <div
        className="relative z-10 w-full max-w-6xl mt-14 px-2"
        style={{ animation: 'fade-in 0.8s ease 0.2s both' }}
      >
        <div className="flex justify-center mb-8">
          <div className="w-full max-w-[520px] grid grid-cols-5 items-end gap-x-6 md:gap-x-8">
            <span className="inline-flex flex-col items-center gap-2 shrink-0 col-start-1">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{SENTINEL_AGENT.emoji}</span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{SENTINEL_AGENT.name}</span>
            </span>
            <span className="inline-flex flex-col items-center gap-2 shrink-0 col-start-3 -translate-y-3 md:-translate-y-4">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>
            </span>
          </div>
        </div>

        <div className="flex items-start justify-start md:justify-center gap-x-6 md:gap-x-8 gap-y-4 overflow-x-auto pb-3">
          {PIPELINE_AGENTS.map((agent) => (
            <span key={agent.name} className="inline-flex flex-col items-center gap-2 shrink-0 min-w-[72px]">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{agent.emoji}</span>
              <span className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center">{agent.name}</span>
            </span>
          ))}
        </div>

        <p className="text-[12px] md:text-[13px] text-[var(--color-base)] leading-relaxed max-w-4xl mx-auto text-center mt-8">
          Hai una squadra di agenti AI virtuali disponibile 24 ore su 24: lavorano per te, cercano opportunità, analizzano offerte, preparano i materiali e si coordinano tra loro in autonomia, mentre tu mantieni sempre il controllo.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
          <Link
            href="/download"
            className="px-6 py-3 rounded text-[12px] font-bold tracking-wider no-underline transition-all"
            style={{ background: 'var(--color-green)', color: '#060608', boxShadow: '0 0 20px rgba(0,232,122,0.25)' }}
          >
            {t('hero_cta')}
          </Link>
          <Link
            href="/stats"
            className="px-6 py-3 rounded text-[12px] font-semibold tracking-wider no-underline transition-all border border-[var(--color-border)] text-[var(--color-bright)] hover:border-[var(--color-muted)]"
          >
            <span className="inline-flex items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C4 14.09 3.48 13.22 3.32 12.77c-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <span>{t('nav_github')}</span>
            </span>
          </Link>
        </div>
      </div>
    </section>
  )
}
