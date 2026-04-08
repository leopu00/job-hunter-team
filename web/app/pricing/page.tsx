'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'
import FadeInSection from '../components/landing/FadeInSection'

const T = {
  it: {
    title: 'Costi',
    subtitle: 'Job Hunter Team non ha piani SaaS. Scarichi il launcher desktop gratis e paghi solo gli eventuali servizi esterni che scegli di collegare.',
    badge: 'trasparenza costi',
    card_software: 'Software JHT',
    card_software_price: '€0',
    card_software_desc: 'Launcher desktop, dashboard locale, aggiornamenti e codice open source.',
    card_software_cta: 'Scarica JHT',
    card_api: 'API AI',
    card_api_price: 'A consumo',
    card_api_desc: 'Porti la tua chiave provider e paghi direttamente il consumo reale dei modelli.',
    card_api_cta: 'Leggi la guida',
    card_infra: 'Infra locale',
    card_infra_price: 'Il tuo computer',
    card_infra_desc: 'Nessun cloud JHT obbligatorio: runtime, log e dati restano in locale.',
    card_infra_cta: 'Vedi FAQ',
    included_title: 'Cosa e incluso, cosa no',
    included_name: 'Voce',
    included_yes: 'Incluso in JHT',
    included_no: 'Costo esterno possibile',
    row_launcher: 'Launcher desktop e dashboard locale',
    row_updates: 'Aggiornamenti del progetto',
    row_agents: 'Team di agenti e workflow applicativo',
    row_storage: 'Dati, log e workspace locali',
    row_ai: 'Token API dei modelli AI',
    row_provider: 'Account provider AI / billing',
    yes_free: 'Si, gratis',
    yes_local: 'Si, sul tuo computer',
    no_none: 'No',
    no_usage: 'Si, solo se usi provider esterni',
    no_provider: 'Si, dipende dal provider scelto',
    faq_title: 'FAQ costi',
    faq1_q: 'JHT e gratuito?',
    faq1_a: 'Si. Il software, il launcher desktop e la dashboard locale sono gratuiti e open source.',
    faq2_q: 'Allora cosa pago davvero?',
    faq2_a: 'Solo l eventuale consumo dei provider AI che colleghi, per esempio Anthropic o OpenAI. JHT non ti fattura un abbonamento.',
    faq3_q: 'Serve carta di credito per scaricarlo?',
    faq3_a: 'No. Per scaricare e installare JHT non serve nessun pagamento. Una carta puo servire solo sul provider AI scelto da te.',
    faq4_q: 'I miei dati passano dai server di JHT?',
    faq4_a: 'No. Workspace, log, profilo e dashboard restano locali. Le sole chiamate esterne dipendono dai provider e servizi che configuri.',
    footer_prev: '← FAQ',
    footer_next: 'Download →',
  },
  en: {
    title: 'Costs',
    subtitle: 'Job Hunter Team does not use SaaS plans. You download the desktop launcher for free and only pay for any external services you choose to connect.',
    badge: 'cost transparency',
    card_software: 'JHT software',
    card_software_price: '€0',
    card_software_desc: 'Desktop launcher, local dashboard, updates, and open-source code.',
    card_software_cta: 'Download JHT',
    card_api: 'AI APIs',
    card_api_price: 'Usage-based',
    card_api_desc: 'Bring your own provider key and pay providers directly for actual model usage.',
    card_api_cta: 'Read the guide',
    card_infra: 'Local infra',
    card_infra_price: 'Your computer',
    card_infra_desc: 'No mandatory JHT cloud: runtime, logs, and data stay local.',
    card_infra_cta: 'View FAQ',
    included_title: 'What is included and what is not',
    included_name: 'Item',
    included_yes: 'Included in JHT',
    included_no: 'Possible external cost',
    row_launcher: 'Desktop launcher and local dashboard',
    row_updates: 'Project updates',
    row_agents: 'Agent team and app workflow',
    row_storage: 'Local data, logs, and workspace',
    row_ai: 'AI model API tokens',
    row_provider: 'AI provider account / billing',
    yes_free: 'Yes, free',
    yes_local: 'Yes, on your computer',
    no_none: 'No',
    no_usage: 'Yes, only if you use external providers',
    no_provider: 'Yes, depends on the provider you choose',
    faq_title: 'Cost FAQ',
    faq1_q: 'Is JHT free?',
    faq1_a: 'Yes. The software, desktop launcher, and local dashboard are free and open source.',
    faq2_q: 'So what do I actually pay for?',
    faq2_a: 'Only the usage of any AI providers you connect, such as Anthropic or OpenAI. JHT does not bill you a subscription.',
    faq3_q: 'Do I need a credit card to download it?',
    faq3_a: 'No. Downloading and installing JHT requires no payment. A card may only be needed for the AI provider you choose.',
    faq4_q: 'Do my data go through JHT servers?',
    faq4_a: 'No. Your workspace, logs, profile, and dashboard stay local. External calls only depend on the providers and services you configure.',
    footer_prev: '← FAQ',
    footer_next: 'Download →',
  },
}

type TKey = keyof typeof T.it

type CardDef = {
  title: TKey
  price: TKey
  desc: TKey
  cta: TKey
  href: string
  accent: string
}

const CARDS: CardDef[] = [
  {
    title: 'card_software',
    price: 'card_software_price',
    desc: 'card_software_desc',
    cta: 'card_software_cta',
    href: '/download',
    accent: 'var(--color-green)',
  },
  {
    title: 'card_infra',
    price: 'card_infra_price',
    desc: 'card_infra_desc',
    cta: 'card_infra_cta',
    href: '/faq',
    accent: 'var(--color-yellow)',
  },
]

const ROWS: { label: TKey; included: TKey; external: TKey }[] = [
  { label: 'row_launcher', included: 'yes_free', external: 'no_none' },
  { label: 'row_updates', included: 'yes_free', external: 'no_none' },
  { label: 'row_agents', included: 'yes_free', external: 'no_none' },
  { label: 'row_storage', included: 'yes_local', external: 'no_none' },
  { label: 'row_ai', included: 'no_none', external: 'no_usage' },
  { label: 'row_provider', included: 'no_none', external: 'no_provider' },
]

function PricingJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Job Hunter Team',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'macOS, Windows, Linux',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      description: 'Open-source desktop launcher and local dashboard',
    },
  }

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
}

function PricingContent() {
  const { lang } = useLandingI18n()
  const tx = T[lang as 'it' | 'en'] ?? T.it
  const t = (key: TKey) => tx[key] ?? key
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const faqs = [
    { q: t('faq1_q'), a: t('faq1_a') },
    { q: t('faq2_q'), a: t('faq2_a') },
    { q: t('faq3_q'), a: t('faq3_a') },
    { q: t('faq4_q'), a: t('faq4_a') },
  ]

  return (
    <main style={{ position: 'relative', zIndex: 1 }}>
      <PricingJsonLd />
      <LandingNav />

      <div className="max-w-5xl mx-auto px-5 pt-32 pb-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center mb-4 px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]">
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">{t('badge')}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)]">{t('title')}</h1>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 max-w-2xl mx-auto leading-relaxed">{t('subtitle')}</p>
        </div>

        <FadeInSection>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
            {CARDS.map((card, index) => (
              <div
                key={card.title}
                className="rounded-xl p-6 flex flex-col border border-[var(--color-border)] transition-all duration-200"
                style={{
                  background: 'var(--color-card)',
                  animation: `fade-in 0.4s ease ${index * 0.08}s both`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              >
                <p className="text-[11px] font-semibold tracking-widest uppercase mb-3" style={{ color: card.accent }}>
                  {t(card.title)}
                </p>
                <p className="text-3xl font-bold text-[var(--color-white)] mb-3">{t(card.price)}</p>
                <p className="text-[11px] leading-relaxed text-[var(--color-dim)] mb-6 flex-1">{t(card.desc)}</p>
                <Link
                  href={card.href}
                  className="block text-center py-2.5 rounded-lg text-[11px] font-semibold tracking-wide no-underline transition-all"
                  style={{
                    border: `1px solid ${card.accent}`,
                    color: card.accent,
                  }}
                >
                  {t(card.cta)}
                </Link>
              </div>
            ))}
          </div>
        </FadeInSection>

        <FadeInSection delay={100}>
          <div className="mb-16">
            <h2 className="text-[16px] font-bold text-[var(--color-white)] mb-5 text-center">{t('included_title')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }} aria-label={t('included_title')}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th scope="col" className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--color-dim)', width: '40%' }}>
                      {t('included_name')}
                    </th>
                    <th scope="col" className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--color-green)' }}>
                      {t('included_yes')}
                    </th>
                    <th scope="col" className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--color-yellow)' }}>
                      {t('included_no')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, index) => (
                    <tr
                      key={row.label}
                      className="transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td className="py-2.5 px-3 font-medium text-[var(--color-muted)]">{t(row.label)}</td>
                      <td className="py-2.5 px-3 text-[var(--color-bright)]">{t(row.included)}</td>
                      <td className="py-2.5 px-3 text-[var(--color-dim)]">{t(row.external)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </FadeInSection>

        <FadeInSection delay={200}>
          <div className="max-w-2xl mx-auto">
            <h2 className="text-[16px] font-bold text-[var(--color-white)] mb-5 text-center">{t('faq_title')}</h2>
            <div className="flex flex-col">
              {faqs.map((faq, index) => (
                <div key={faq.q} className="border-b border-[var(--color-border)]">
                  <button
                    id={`pricing-faq-btn-${index}`}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    aria-expanded={openFaq === index}
                    aria-controls={`pricing-faq-panel-${index}`}
                    className="w-full flex items-center justify-between gap-4 py-4 px-1 cursor-pointer text-left"
                    style={{ background: 'none', border: 'none', fontFamily: 'inherit' }}
                  >
                    <span className="text-[12px] font-semibold text-[var(--color-white)]">{faq.q}</span>
                    <span
                      className="text-[var(--color-dim)] text-[14px] flex-shrink-0"
                      aria-hidden="true"
                      style={{ transform: openFaq === index ? 'rotate(45deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                    >
                      +
                    </span>
                  </button>
                  {openFaq === index && (
                    <div
                      id={`pricing-faq-panel-${index}`}
                      role="region"
                      aria-labelledby={`pricing-faq-btn-${index}`}
                      className="pb-4 px-1 text-[11px] text-[var(--color-muted)] leading-relaxed"
                      style={{ animation: 'fade-in 0.15s ease both' }}
                    >
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </FadeInSection>

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/faq" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            {t('footer_prev')}
          </Link>
          <Link href="/download" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            {t('footer_next')}
          </Link>
        </div>
      </div>

      <LandingFooter />
      <ScrollToTop />
    </main>
  )
}

export default function PricingPage() {
  return (
    <LandingI18nProvider>
      <PricingContent />
    </LandingI18nProvider>
  )
}
