'use client'

import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

const T = {
  it: {
    title: 'Privacy Policy',
    updated: 'Ultimo aggiornamento: Aprile 2026',
    intro: 'Job Hunter Team (JHT) rispetta la tua privacy. Questa pagina spiega come vengono trattati i tuoi dati.',
    s1_title: 'Dati raccolti',
    s1_body: 'JHT gira interamente in locale sul tuo computer. Non raccogliamo, trasmettiamo o memorizziamo dati personali sui nostri server. I tuoi dati (profilo, CV, candidature, preferenze) restano nella cartella di lavoro locale che scegli al primo avvio.',
    s2_title: 'Chiamate API esterne',
    s2_body: 'Quando usi gli agenti AI, le tue richieste vengono inviate ad Anthropic (Claude API) per l\'elaborazione. Queste chiamate sono soggette alla privacy policy di Anthropic. Nessun altro servizio esterno riceve i tuoi dati.',
    s3_title: 'Chiavi API',
    s3_body: 'Le chiavi API che configuri vengono salvate esclusivamente in locale nella directory ~/.jht/secrets/. Non vengono mai trasmesse, condivise o committate nel codice sorgente.',
    s4_title: 'Cookie e tracciamento',
    s4_body: 'La versione locale di JHT non usa cookie di terze parti, analytics o strumenti di tracciamento. La versione cloud (se disponibile) usa solo cookie tecnici strettamente necessari per l\'autenticazione.',
    s5_title: 'Open source',
    s5_body: 'JHT e completamente open source. Puoi verificare in qualsiasi momento cosa fa il codice esaminando il repository su GitHub.',
    s6_title: 'Contatti',
    s6_body: 'Per domande sulla privacy, scrivi a info@jobhunterteam.ai.',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: April 2026',
    intro: 'Job Hunter Team (JHT) respects your privacy. This page explains how your data is handled.',
    s1_title: 'Data collected',
    s1_body: 'JHT runs entirely on your local computer. We do not collect, transmit, or store personal data on our servers. Your data (profile, CV, applications, preferences) stays in the local workspace folder you choose at first launch.',
    s2_title: 'External API calls',
    s2_body: 'When you use AI agents, your requests are sent to Anthropic (Claude API) for processing. These calls are subject to Anthropic\'s privacy policy. No other external service receives your data.',
    s3_title: 'API keys',
    s3_body: 'API keys you configure are stored exclusively locally in the ~/.jht/secrets/ directory. They are never transmitted, shared, or committed to source code.',
    s4_title: 'Cookies and tracking',
    s4_body: 'The local version of JHT uses no third-party cookies, analytics, or tracking tools. The cloud version (if available) only uses strictly necessary technical cookies for authentication.',
    s5_title: 'Open source',
    s5_body: 'JHT is fully open source. You can verify what the code does at any time by examining the repository on GitHub.',
    s6_title: 'Contact',
    s6_body: 'For privacy questions, write to info@jobhunterteam.ai.',
  },
}

type TKey = keyof typeof T.it

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-2">{title}</h2>
      <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">{body}</p>
    </div>
  )
}

function PrivacyContent() {
  const { lang } = useLandingI18n()
  const tx = T[lang as 'it' | 'en'] ?? T.it
  const t = (k: TKey) => tx[k] ?? k

  const sections: [TKey, TKey][] = [
    ['s1_title', 's1_body'], ['s2_title', 's2_body'], ['s3_title', 's3_body'],
    ['s4_title', 's4_body'], ['s5_title', 's5_body'], ['s6_title', 's6_body'],
  ]

  return (
    <main style={{ position: 'relative', zIndex: 1, animation: 'fade-in 0.35s ease both' }}>
      <LandingNav />
      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Home</Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">Privacy</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">{t('title')}</h1>
          <p className="text-[var(--color-dim)] text-[10px] mt-2">{t('updated')}</p>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">{t('intro')}</p>
        </div>

        {sections.map(([titleKey, bodyKey]) => (
          <Section key={titleKey} title={t(titleKey)} body={t(bodyKey)} />
        ))}

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/faq" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; FAQ
          </Link>
          <Link href="/pricing" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            Pricing &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  )
}

export default function PrivacyPage() {
  return (
    <LandingI18nProvider>
      <PrivacyContent />
    </LandingI18nProvider>
  )
}
