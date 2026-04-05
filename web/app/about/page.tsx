'use client'

import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import FadeInSection from '../components/landing/FadeInSection'
import ScrollToTop from '../components/landing/ScrollToTop'

/* ── Dati agenti ──────────────────────────────────────────────────── */

type AgentKey = 'alfa' | 'scout' | 'analista' | 'scorer' | 'scrittore' | 'critico' | 'sentinella' | 'assistente'

const AGENTS: { key: AgentKey; emoji: string; color: string }[] = [
  { key: 'alfa',       emoji: '\u{1F468}\u200D\u2708\uFE0F', color: '#ff9100' },
  { key: 'scout',      emoji: '\uD83D\uDD75\uFE0F',          color: '#2196f3' },
  { key: 'analista',   emoji: '\u{1F468}\u200D\uD83D\uDD2C', color: '#00e676' },
  { key: 'scorer',     emoji: '\u{1F468}\u200D\uD83D\uDCBB', color: '#b388ff' },
  { key: 'scrittore',  emoji: '\u{1F468}\u200D\uD83C\uDFEB', color: '#ffd600' },
  { key: 'critico',    emoji: '\u{1F468}\u200D\u2696\uFE0F', color: '#f44336' },
  { key: 'sentinella', emoji: '\uD83D\uDC82',                 color: '#607d8b' },
  { key: 'assistente', emoji: '\uD83E\uDDD1\u200D\uD83D\uDCBB', color: '#26c6da' },
]

const TIMELINE = ['2025 Q3', '2025 Q4', '2026 Q1', '2026 Q2']

/* ── Componenti sezione ───────────────────────────────────────────── */

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" aria-hidden="true" />
      <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--color-green)' }}>{text}</span>
    </div>
  )
}

/* ── Contenuto pagina ─────────────────────────────────────────────── */

function AboutJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Job Hunter Team',
    url: 'https://jobhunterteam.ai',
    description: 'Un team di agenti AI open-source che automatizza la ricerca di lavoro.',
    foundingDate: '2025',
    sameAs: ['https://github.com/leopu00/job-hunter-team'],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
}

function AboutContent() {
  const { t } = useLandingI18n()

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg, #060608)', color: 'var(--color-white, #e8e8e8)' }}>
      <AboutJsonLd />
      <LandingNav />

      <main className="max-w-4xl mx-auto px-6 pt-28 pb-16">

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="text-center mb-20">
          <div className="inline-flex items-center gap-2 mb-5">
            <div className="w-2 h-2 rounded-full" aria-hidden="true" style={{ background: 'var(--color-green)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--color-green)' }}>
              {t('about_badge')}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-5">
            {t('about_title_1')}<br />
            <span style={{ color: 'var(--color-green)' }}>{t('about_title_2')}</span>
          </h1>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-2xl mx-auto">
            {t('about_intro')}
          </p>
        </section>

        {/* ── La storia + Timeline ──────────────────────────────── */}
        <FadeInSection><section className="mb-20">
          <SectionLabel text={t('about_story_label')} />
          <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-4">{t('about_story_title')}</h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-2xl mb-8">
            {t('about_story_desc')}
          </p>

          {/* Timeline */}
          <div className="relative pl-6 border-l border-[var(--color-border)]">
            {TIMELINE.map((date, i) => (
              <div key={i} className="mb-6 last:mb-0 relative">
                <div className="absolute -left-[25px] w-2.5 h-2.5 rounded-full border-2" aria-hidden="true"
                  style={{ borderColor: 'var(--color-green)', background: i === TIMELINE.length - 1 ? 'var(--color-green)' : 'var(--color-bg, #060608)' }} />
                <span className="text-[9px] font-bold tracking-widest text-[var(--color-green)] uppercase">{date}</span>
                <p className="text-[11px] text-[var(--color-muted)] mt-1">
                  {t(`about_tl_${i}` as 'about_tl_0')}
                </p>
              </div>
            ))}
          </div>
        </section></FadeInSection>

        {/* ── Gli agenti ────────────────────────────────────────── */}
        <FadeInSection delay={100}><section className="mb-20">
          <SectionLabel text={t('about_agents_label')} />
          <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-4">{t('about_agents_title')}</h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-2xl mb-8">
            {t('about_agents_desc')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {AGENTS.map(({ key, emoji, color }) => (
              <div key={key} className="rounded-lg p-5 border border-[var(--color-border)] transition-colors hover:border-[var(--color-dim)]"
                style={{ background: 'var(--color-panel, rgba(255,255,255,0.02))' }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl" aria-hidden="true">{emoji}</span>
                  <h3 className="text-[13px] font-bold" style={{ color }}>
                    {t(`about_agent_${key}_name` as 'about_agent_alfa_name')}
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                  {t(`about_agent_${key}_desc` as 'about_agent_alfa_desc')}
                </p>
              </div>
            ))}
          </div>
        </section></FadeInSection>

        {/* ── Come funziona ─────────────────────────────────────── */}
        <FadeInSection delay={100}><section className="mb-20">
          <SectionLabel text={t('about_how_label')} />
          <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-4">{t('about_how_title')}</h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-2xl mb-8">
            {t('about_how_desc')}
          </p>

          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-lg border border-[var(--color-border)]"
                style={{ background: 'var(--color-panel, rgba(255,255,255,0.02))' }}>
                <span className="text-[11px] font-mono font-bold mt-px flex-shrink-0" style={{ color: 'var(--color-green)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                  {t(`about_how_${i}` as 'about_how_0')}
                </p>
              </div>
            ))}
          </div>
        </section></FadeInSection>

        {/* ── Visione futura ────────────────────────────────────── */}
        <FadeInSection delay={100}><section className="mb-16">
          <SectionLabel text={t('about_vision_label')} />
          <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-4">{t('about_vision_title')}</h2>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-2xl mb-8">
            {t('about_vision_desc')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-lg border border-[var(--color-border)]"
                style={{ background: 'var(--color-panel, rgba(255,255,255,0.02))' }}>
                <span className="text-[13px] mt-px" aria-hidden="true" style={{ color: 'var(--color-green)' }}>{'\u2192'}</span>
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                  {t(`about_vision_${i}` as 'about_vision_0')}
                </p>
              </div>
            ))}
          </div>
        </section></FadeInSection>

        {/* ── CTA ───────────────────────────────────────────────── */}
        <section className="text-center py-12 border-t border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-muted)] mb-5">
            {t('cta_desc')}
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/download" className="px-6 py-2.5 rounded text-[11px] font-bold tracking-wider no-underline transition-all"
              style={{ background: 'var(--color-green)', color: '#060608' }}>
              {t('cta_button')}
            </Link>
            <Link href="/team" className="px-6 py-2.5 rounded text-[11px] font-bold tracking-wider no-underline transition-all"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
              {t('cta_team')}
            </Link>
          </div>
        </section>

      </main>
      <LandingFooter />
      <ScrollToTop />
    </div>
  )
}

export default function AboutPage() {
  return (
    <LandingI18nProvider>
      <AboutContent />
    </LandingI18nProvider>
  )
}
