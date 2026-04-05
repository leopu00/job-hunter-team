'use client'

import { useLandingI18n } from './LandingI18n'

const STEPS_META = [
  { n: '01', titleKey: 'step_0_title', descKey: 'step_0_desc', code: 'jht profile set --role "Senior Dev" --stack "React, Node"' },
  { n: '02', titleKey: 'step_1_title', descKey: 'step_1_desc', code: '[scout] 47 found → [analista] 12 relevant → [scorer] 5 top matches' },
  { n: '03', titleKey: 'step_2_title', descKey: 'step_2_desc', code: '[capitano] 3 applications ready — awaiting your review ✓' },
] as const

export default function LandingSteps() {
  const { t } = useLandingI18n()

  return (
    <section id="how" aria-label="Come funziona" className="px-6 py-24 relative">
      {/* Divider line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-24" aria-hidden="true" style={{ background: 'linear-gradient(180deg, transparent, var(--color-border))' }} />

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-3 block">
            {t('steps_label')}
          </span>
          <h2 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight">
            {t('steps_title')}
          </h2>
        </div>

        <div className="flex flex-col gap-8">
          {STEPS_META.map((s, i) => (
            <div key={i} className="flex gap-6 items-start">
              {/* Step number */}
              <div className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center border border-[var(--color-border)]"
                style={{ background: 'var(--color-panel)', color: 'var(--color-green)', fontSize: 14, fontWeight: 700 }}>
                {s.n}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-bold text-[var(--color-white)] mb-2">{t(s.titleKey)}</h3>
                <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-3">{t(s.descKey)}</p>

                {/* Code snippet */}
                <div className="rounded px-3 py-2 border border-[var(--color-border)] overflow-x-auto"
                  style={{ background: 'var(--color-void)' }}>
                  <code className="text-[10px] md:text-[11px] text-[var(--color-base)] whitespace-nowrap">{s.code}</code>
                </div>

                {/* Connector */}
                {i < STEPS_META.length - 1 && (
                  <div className="ml-6 mt-4 w-px h-6" aria-hidden="true" style={{ background: 'var(--color-border)' }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
