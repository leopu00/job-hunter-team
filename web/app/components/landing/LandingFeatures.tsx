'use client'

import { useLandingI18n } from './LandingI18n'

const FEATURES_META = [
  { icon: '⚡', titleKey: 'feat_0_title', descKey: 'feat_0_desc', accent: 'var(--color-green)' },
  { icon: '◉',  titleKey: 'feat_1_title', descKey: 'feat_1_desc', accent: 'var(--color-blue)' },
  { icon: '✦',  titleKey: 'feat_2_title', descKey: 'feat_2_desc', accent: 'var(--color-purple)' },
  { icon: '△',  titleKey: 'feat_3_title', descKey: 'feat_3_desc', accent: 'var(--color-yellow)' },
  { icon: '◆',  titleKey: 'feat_4_title', descKey: 'feat_4_desc', accent: 'var(--color-orange)' },
  { icon: '⬡',  titleKey: 'feat_5_title', descKey: 'feat_5_desc', accent: 'var(--color-green)' },
] as const

export default function LandingFeatures() {
  const { t } = useLandingI18n()

  return (
    <section id="features" aria-label="Funzionalità" className="px-6 py-24 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-3 block">
            {t('feat_label')}
          </span>
          <h2 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight">
            {t('feat_title_1')}<br />{t('feat_title_2')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES_META.map((f, i) => (
            <div
              key={i}
              className="landing-feature-card group rounded-lg p-6 border border-[var(--color-border)] transition-all duration-300"
              style={{ background: 'var(--color-panel)', animationDelay: `${i * 0.08}s` }}
            >
              <div
                className="w-8 h-8 rounded flex items-center justify-center text-[16px] mb-4"
                aria-hidden="true"
                style={{ background: `${f.accent}15`, border: `1px solid ${f.accent}30` }}
              >
                {f.icon}
              </div>
              <h3 className="text-[13px] font-bold text-[var(--color-white)] mb-2 tracking-wide">
                {t(f.titleKey)}
              </h3>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {t(f.descKey)}
              </p>
              {/* Glow border on hover */}
              <div
                className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ boxShadow: `inset 0 0 0 1px ${f.accent}40, 0 0 15px ${f.accent}08` }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
