'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

/* ── i18n ─────────────────────────────────────────────────────────── */

const T = {
  it: {
    title: 'Prezzi',
    subtitle: 'Scegli il piano adatto a te. Tutti i piani includono aggiornamenti gratuiti.',
    monthly: 'Mensile',
    yearly: 'Annuale',
    yearly_save: 'Risparmi 20%',
    month: '/mese',
    year: '/anno',
    free_name: 'Free',
    free_desc: 'Per iniziare a cercare lavoro con gli agenti AI.',
    pro_name: 'Pro',
    pro_desc: 'Per chi cerca lavoro seriamente e vuole risultati veloci.',
    ent_name: 'Enterprise',
    ent_desc: 'Per team HR, agenzie e uso professionale ad alto volume.',
    popular: 'Popolare',
    cta_free: 'Inizia gratis',
    cta_pro: 'Scegli Pro',
    cta_ent: 'Contattaci',
    features_title: 'Confronto funzionalita',
    faq_title: 'Domande sui prezzi',
    feature_agents: 'Agenti AI',
    feature_searches: 'Ricerche al mese',
    feature_cv: 'CV e cover letter',
    feature_analytics: 'Analytics',
    feature_priority: 'Supporto prioritario',
    feature_api: 'Accesso API',
    feature_custom: 'Agenti personalizzati',
    feature_sla: 'SLA garantito',
    feature_onboarding: 'Onboarding dedicato',
    val_3agents: '3 agenti',
    val_7agents: '7 agenti',
    val_unlimited: 'Illimitati',
    val_10: '10',
    val_100: '100',
    val_unlimited_s: 'Illimitate',
    val_5: '5 / mese',
    val_50: '50 / mese',
    val_basic: 'Base',
    val_advanced: 'Avanzato',
    val_full: 'Completo',
    faq1_q: 'Posso cambiare piano in qualsiasi momento?',
    faq1_a: 'Si, puoi fare upgrade o downgrade in qualsiasi momento. Il cambio e immediato e il costo viene calcolato pro-rata.',
    faq2_q: 'Cosa succede quando finiscono le ricerche mensili?',
    faq2_a: 'Nel piano Free le ricerche si fermano fino al mese successivo. Nei piani a pagamento puoi acquistare ricerche aggiuntive oppure fare upgrade.',
    faq3_q: 'Serve una carta di credito per il piano Free?',
    faq3_a: 'No, il piano Free non richiede nessun metodo di pagamento. Puoi usarlo quanto vuoi senza impegno.',
    faq4_q: 'Come funziona il piano Enterprise?',
    faq4_a: 'Il piano Enterprise e personalizzato per le esigenze della tua organizzazione. Contattaci per una demo e un preventivo su misura.',
    faq5_q: 'I miei dati sono al sicuro?',
    faq5_a: 'Tutti i dati vengono processati in locale sul tuo computer. Nessun dato personale viene inviato ai nostri server. Le uniche chiamate esterne sono verso le API AI per gli agenti.',
  },
  en: {
    title: 'Pricing',
    subtitle: 'Choose the plan that fits you. All plans include free updates.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    yearly_save: 'Save 20%',
    month: '/mo',
    year: '/yr',
    free_name: 'Free',
    free_desc: 'Get started with AI-powered job hunting.',
    pro_name: 'Pro',
    pro_desc: 'For serious job seekers who want fast results.',
    ent_name: 'Enterprise',
    ent_desc: 'For HR teams, agencies, and high-volume professional use.',
    popular: 'Popular',
    cta_free: 'Start free',
    cta_pro: 'Choose Pro',
    cta_ent: 'Contact us',
    features_title: 'Feature comparison',
    faq_title: 'Pricing FAQ',
    feature_agents: 'AI Agents',
    feature_searches: 'Searches / month',
    feature_cv: 'CV & cover letters',
    feature_analytics: 'Analytics',
    feature_priority: 'Priority support',
    feature_api: 'API access',
    feature_custom: 'Custom agents',
    feature_sla: 'Guaranteed SLA',
    feature_onboarding: 'Dedicated onboarding',
    val_3agents: '3 agents',
    val_7agents: '7 agents',
    val_unlimited: 'Unlimited',
    val_10: '10',
    val_100: '100',
    val_unlimited_s: 'Unlimited',
    val_5: '5 / month',
    val_50: '50 / month',
    val_basic: 'Basic',
    val_advanced: 'Advanced',
    val_full: 'Full',
    faq1_q: 'Can I change plans anytime?',
    faq1_a: 'Yes, you can upgrade or downgrade at any time. Changes take effect immediately with pro-rata billing.',
    faq2_q: 'What happens when I run out of monthly searches?',
    faq2_a: 'On Free, searches pause until next month. On paid plans, you can purchase additional searches or upgrade.',
    faq3_q: 'Do I need a credit card for the Free plan?',
    faq3_a: 'No, the Free plan requires no payment method. Use it as long as you want, no strings attached.',
    faq4_q: 'How does the Enterprise plan work?',
    faq4_a: 'Enterprise is customized for your organization. Contact us for a demo and a tailored quote.',
    faq5_q: 'Is my data safe?',
    faq5_a: 'All data is processed locally on your computer. No personal data is sent to our servers. The only external calls are to AI APIs for the agents.',
  },
}

type TKey = keyof typeof T.it

/* ── Plan data ────────────────────────────────────────────────────── */

type Plan = {
  nameKey: TKey
  descKey: TKey
  priceMonthly: number | null
  priceYearly: number | null
  ctaKey: TKey
  ctaHref: string
  popular?: boolean
  accent: string
  features: { key: TKey; value: TKey | true | false }[]
}

const PLANS: Plan[] = [
  {
    nameKey: 'free_name', descKey: 'free_desc',
    priceMonthly: 0, priceYearly: 0,
    ctaKey: 'cta_free', ctaHref: '/download',
    accent: 'var(--color-dim)',
    features: [
      { key: 'feature_agents', value: 'val_3agents' },
      { key: 'feature_searches', value: 'val_10' },
      { key: 'feature_cv', value: 'val_5' },
      { key: 'feature_analytics', value: 'val_basic' },
      { key: 'feature_priority', value: false },
      { key: 'feature_api', value: false },
      { key: 'feature_custom', value: false },
      { key: 'feature_sla', value: false },
      { key: 'feature_onboarding', value: false },
    ],
  },
  {
    nameKey: 'pro_name', descKey: 'pro_desc',
    priceMonthly: 19, priceYearly: 15,
    ctaKey: 'cta_pro', ctaHref: '/download',
    popular: true,
    accent: 'var(--color-green)',
    features: [
      { key: 'feature_agents', value: 'val_7agents' },
      { key: 'feature_searches', value: 'val_100' },
      { key: 'feature_cv', value: 'val_50' },
      { key: 'feature_analytics', value: 'val_advanced' },
      { key: 'feature_priority', value: true },
      { key: 'feature_api', value: true },
      { key: 'feature_custom', value: false },
      { key: 'feature_sla', value: false },
      { key: 'feature_onboarding', value: false },
    ],
  },
  {
    nameKey: 'ent_name', descKey: 'ent_desc',
    priceMonthly: null, priceYearly: null,
    ctaKey: 'cta_ent', ctaHref: 'mailto:info@jobhunterteam.ai',
    accent: 'var(--color-blue)',
    features: [
      { key: 'feature_agents', value: 'val_unlimited' },
      { key: 'feature_searches', value: 'val_unlimited_s' },
      { key: 'feature_cv', value: 'val_unlimited_s' },
      { key: 'feature_analytics', value: 'val_full' },
      { key: 'feature_priority', value: true },
      { key: 'feature_api', value: true },
      { key: 'feature_custom', value: true },
      { key: 'feature_sla', value: true },
      { key: 'feature_onboarding', value: true },
    ],
  },
]

const FEATURE_KEYS: TKey[] = [
  'feature_agents', 'feature_searches', 'feature_cv', 'feature_analytics',
  'feature_priority', 'feature_api', 'feature_custom', 'feature_sla', 'feature_onboarding',
]

/* ── Components ───────────────────────────────────────────────────── */

function PricingContent() {
  const { lang } = useLandingI18n()
  const tx = T[lang as 'it' | 'en'] ?? T.it
  const t = (k: TKey) => tx[k] ?? k
  const [yearly, setYearly] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const faqs = [
    { q: t('faq1_q'), a: t('faq1_a') },
    { q: t('faq2_q'), a: t('faq2_a') },
    { q: t('faq3_q'), a: t('faq3_a') },
    { q: t('faq4_q'), a: t('faq4_a') },
    { q: t('faq5_q'), a: t('faq5_a') },
  ]

  return (
    <main style={{ position: 'relative', zIndex: 1 }}>
      <LandingNav />

      <div className="max-w-5xl mx-auto px-5 pt-32 pb-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Home</Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">{t('title')}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)]">{t('title')}</h1>
          <p className="text-[var(--color-muted)] text-[12px] mt-2 max-w-md mx-auto leading-relaxed">{t('subtitle')}</p>

          {/* Toggle */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <span className="text-[11px]" style={{ color: !yearly ? 'var(--color-white)' : 'var(--color-dim)' }}>{t('monthly')}</span>
            <button
              onClick={() => setYearly((v) => !v)}
              role="switch"
              aria-checked={yearly}
              aria-label={yearly ? t('yearly') : t('monthly')}
              className="relative w-11 h-6 rounded-full cursor-pointer transition-colors"
              style={{ background: yearly ? 'var(--color-green)' : 'var(--color-border)', border: 'none' }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                aria-hidden="true"
                style={{ left: yearly ? 22 : 2 }}
              />
            </button>
            <span className="text-[11px]" style={{ color: yearly ? 'var(--color-white)' : 'var(--color-dim)' }}>
              {t('yearly')}
            </span>
            {yearly && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--color-green)' }}>
                {t('yearly_save')}
              </span>
            )}
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
          {PLANS.map((plan) => {
            const price = yearly ? plan.priceYearly : plan.priceMonthly
            return (
              <div
                key={plan.nameKey}
                className="relative rounded-xl p-6 flex flex-col"
                style={{
                  background: 'var(--color-card)',
                  border: `1px solid ${plan.popular ? 'var(--color-green)' : 'var(--color-border)'}`,
                  boxShadow: plan.popular ? '0 0 24px rgba(0,232,122,0.08)' : 'none',
                }}
              >
                {plan.popular && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold px-3 py-1 rounded-full"
                    style={{ background: 'var(--color-green)', color: 'var(--color-void)' }}
                  >
                    {t('popular')}
                  </span>
                )}

                <h3 className="text-[16px] font-bold" style={{ color: plan.accent }}>{t(plan.nameKey)}</h3>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--color-dim)' }}>{t(plan.descKey)}</p>

                <div className="mt-5 mb-5">
                  {price !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-[var(--color-white)]">
                        {price === 0 ? '0' : `${price}`}
                      </span>
                      <span className="text-[11px] text-[var(--color-dim)]">
                        {price === 0 ? '' : yearly ? t('year') : t('month')}
                      </span>
                    </div>
                  ) : (
                    <span className="text-2xl font-bold text-[var(--color-white)]">Custom</span>
                  )}
                </div>

                <ul className="flex flex-col gap-2 mb-6 flex-1">
                  {plan.features.map((f) => {
                    const val = f.value
                    if (val === false) return null
                    return (
                      <li key={f.key} className="flex items-start gap-2 text-[11px]">
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-green)' }}>
                          {val === true ? '✓' : '▸'}
                        </span>
                        <span style={{ color: 'var(--color-muted)' }}>
                          {t(f.key)}{val !== true ? `: ${t(val)}` : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>

                <Link
                  href={plan.ctaHref}
                  className="block text-center py-2.5 rounded-lg text-[11px] font-semibold tracking-wide no-underline transition-all"
                  style={{
                    background: plan.popular ? 'var(--color-green)' : 'transparent',
                    color: plan.popular ? 'var(--color-void)' : plan.accent,
                    border: `1px solid ${plan.popular ? 'var(--color-green)' : plan.accent}`,
                  }}
                >
                  {t(plan.ctaKey)}
                </Link>
              </div>
            )
          })}
        </div>

        {/* Feature comparison table */}
        <div className="mb-16">
          <h2 className="text-[16px] font-bold text-[var(--color-white)] mb-5 text-center">{t('features_title')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--color-dim)', width: '40%' }} />
                  {PLANS.map((p) => (
                    <th key={p.nameKey} className="text-center py-3 px-3 font-bold" style={{ color: p.accent }}>
                      {t(p.nameKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_KEYS.map((fk, i) => (
                  <tr key={fk} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td className="py-2.5 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>{t(fk)}</td>
                    {PLANS.map((p) => {
                      const feat = p.features.find((f) => f.key === fk)
                      const val = feat?.value
                      return (
                        <td key={p.nameKey} className="text-center py-2.5 px-3">
                          {val === true && <span style={{ color: 'var(--color-green)' }}>✓</span>}
                          {val === false && <span style={{ color: 'var(--color-dim)' }}>—</span>}
                          {typeof val === 'string' && <span style={{ color: 'var(--color-bright)' }}>{t(val)}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-[16px] font-bold text-[var(--color-white)] mb-5 text-center">{t('faq_title')}</h2>
          <div className="flex flex-col">
            {faqs.map((faq, i) => (
              <div key={i} className="border-b border-[var(--color-border)]">
                <button
                  id={`pricing-faq-btn-${i}`}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`pricing-faq-panel-${i}`}
                  className="w-full flex items-center justify-between gap-4 py-4 px-1 cursor-pointer text-left"
                  style={{ background: 'none', border: 'none', fontFamily: 'inherit' }}
                >
                  <span className="text-[12px] font-semibold text-[var(--color-white)]">{faq.q}</span>
                  <span
                    className="text-[var(--color-dim)] text-[14px] flex-shrink-0"
                    aria-hidden="true"
                    style={{ transform: openFaq === i ? 'rotate(45deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div
                    id={`pricing-faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`pricing-faq-btn-${i}`}
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

        {/* Footer nav */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/faq" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; FAQ
          </Link>
          <Link href="/download" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            Download &rarr;
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
