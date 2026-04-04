'use client'

import { useLandingI18n } from './LandingI18n'

const STATS = {
  it: [
    { value: '7', label: 'Agenti AI specializzati' },
    { value: '100%', label: 'Locale e privato' },
    { value: '0', label: 'Dati inviati ai nostri server', unit: '' },
    { value: 'MIT', label: 'Licenza open source' },
  ],
  en: [
    { value: '7', label: 'Specialized AI agents' },
    { value: '100%', label: 'Local and private' },
    { value: '0', label: 'Data sent to our servers', unit: '' },
    { value: 'MIT', label: 'Open source license' },
  ],
}

export default function LandingStats() {
  const { lang } = useLandingI18n()
  const items = STATS[lang as 'it' | 'en'] ?? STATS.it

  return (
    <section className="py-16 px-5">
      <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        {items.map((stat) => (
          <div key={stat.label} className="text-center">
            <div
              className="text-3xl font-bold mb-1"
              style={{ color: 'var(--color-green)' }}
            >
              {stat.value}
            </div>
            <div className="text-[11px] text-[var(--color-dim)] leading-relaxed">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
