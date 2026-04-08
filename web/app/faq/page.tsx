'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'
import FadeInSection from '../components/landing/FadeInSection'

type FaqItem = { q: string; a: React.ReactNode }

/** Testo puro per JSON-LD (schema.org FAQPage) — indice corrisponde a FAQ_ITEMS */
const FAQ_TEXTS: string[] = [
  'Job Hunter Team (JHT) e un sistema open-source che automatizza la ricerca di lavoro usando un team di agenti AI. Ogni agente ha un ruolo specifico: trovare offerte, analizzarle, calcolare il match col tuo profilo, scrivere CV e cover letter personalizzate, e revisionarle. Tutto gira in locale sul tuo computer.',
  'Configuri il tuo profilo e avvii il team dalla dashboard locale aperta dal launcher desktop. Gli agenti collaborano in pipeline: Scout trova offerte, Analista le legge, Scorer le ordina, Scrittore prepara i documenti e Critico li revisiona. Capitano coordina e Sentinella monitora costi e salute del sistema.',
  'Per usare JHT in locale non serve creare un account. Scarichi il launcher desktop, completi il setup iniziale e lavori dal browser sulla dashboard locale aperta sul tuo computer.',
  'Il software e gratuito e open-source. Non c\'e abbonamento JHT: l\'unico costo eventuale e il consumo dei provider AI o dei servizi esterni che decidi di collegare.',
  'Capitano (coordina il team), Scout (cerca offerte), Analista (analizza requisiti), Scorer (calcola match), Scrittore (genera CV e cover letter), Critico (revisiona documenti), Sentinella (monitora budget API).',
  'Apri JHT Desktop, completa il setup iniziale e dalla dashboard locale vai su /team per avviare gli agenti. Gli strumenti terminali restano disponibili soprattutto per sviluppo e troubleshooting avanzato.',
  'Il launcher desktop funziona su macOS 12+, Linux (Ubuntu 22.04+, Debian 12+, Fedora 39+) e Windows 10+. Una connessione internet serve per le chiamate ai provider AI. Per workflow avanzati o di sviluppo possono servire dipendenze aggiuntive come tmux, CLI provider o WSL.',
  'Si. Tutti i dati sono salvati nella cartella di lavoro locale sul tuo computer. Nessun dato viene inviato a server esterni.',
  'Si, ma con funzionalita limitate. Senza chiave API gli agenti AI non possono funzionare, pero puoi usare la web app per gestire candidature manualmente.',
  'JHT e open-source. Puoi contribuire su GitHub: segnala bug, proponi feature, o invia pull request.',
]

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Cos'e Job Hunter Team?",
    a: (
      <>
        Job Hunter Team (JHT) e un sistema open-source che automatizza la ricerca di lavoro
        usando un team di agenti AI. Ogni agente ha un ruolo specifico: trovare offerte, analizzarle,
        calcolare il match col tuo profilo, scrivere CV e cover letter personalizzate, e revisionarle.
        Tutto gira in locale sul tuo computer &mdash; i tuoi dati non lasciano mai la tua macchina.
      </>
    ),
  },
  {
    q: 'Come funziona?',
    a: (
      <>
        Configuri il tuo profilo (competenze, esperienza, preferenze) e avvii il team.
        Gli agenti collaborano in pipeline: lo <strong>Scout</strong> cerca offerte online,
        l&apos;<strong>Analista</strong> le analizza, lo <strong>Scorer</strong> calcola il match,
        lo <strong>Scrittore</strong> prepara i documenti e il <strong>Critico</strong> li revisiona.
        Il <strong>Capitano</strong> coordina tutto e la <strong>Sentinella</strong> monitora i costi.
        Il flusso principale passa dalla dashboard locale aperta dal launcher desktop.
      </>
    ),
  },
  {
    q: 'Serve creare un account?',
    a: (
      <>
        Per usare JHT in locale no. Scarichi il launcher desktop, completi il setup
        iniziale e lavori dal browser sulla dashboard locale aperta sul tuo computer.
        Se colleghi provider AI o altri servizi esterni, valgono naturalmente le regole
        e gli account richiesti da quei servizi.
      </>
    ),
  },
  {
    q: 'Quanto costa?',
    a: (
      <>
        Il software e gratuito e open-source. JHT non ti fattura un abbonamento:
        l&apos;unico costo eventuale e il consumo dei provider AI o dei servizi esterni che scegli
        di collegare. La Sentinella monitora i costi in tempo reale e puoi impostare un budget
        massimo. Senza chiave API puoi comunque usare la dashboard e gestire candidature manualmente.
      </>
    ),
  },
  {
    q: 'Quali agenti ci sono?',
    a: (
      <ul className="flex flex-col gap-1.5 mt-1 mb-0">
        <li><strong>Capitano</strong> &mdash; Coordina il team e gestisce le priorita</li>
        <li><strong>Scout</strong> &mdash; Cerca offerte di lavoro su job board e canali online</li>
        <li><strong>Analista</strong> &mdash; Analizza requisiti, azienda e fit col profilo</li>
        <li><strong>Scorer</strong> &mdash; Calcola un punteggio di match per ogni offerta</li>
        <li><strong>Scrittore</strong> &mdash; Genera CV e cover letter personalizzate</li>
        <li><strong>Critico</strong> &mdash; Revisiona e migliora i documenti prodotti</li>
        <li><strong>Sentinella</strong> &mdash; Monitora budget API, rate limit, salute del sistema</li>
      </ul>
    ),
  },
  {
    q: 'Come si avvia il team?',
    a: (
      <>
        <strong>Flusso principale:</strong> apri JHT Desktop, completa il setup iniziale e vai su{' '}
        <Link href="/team" className="text-[var(--color-green)] hover:underline no-underline">/team</Link>{' '}
        per avviare il team dalla dashboard locale. Servono una cartella di lavoro configurata
        e le credenziali dei provider che vuoi usare.
        <br /><br />
        <strong>Modalita avanzata:</strong> gli strumenti terminali restano disponibili soprattutto
        per sviluppo e troubleshooting, ma non sono il percorso consigliato per l&apos;uso quotidiano.
        <br /><br />
        Consulta la documentazione per istruzioni dettagliate.
      </>
    ),
  },
  {
    q: 'Quali sono i requisiti di sistema?',
    a: (
      <>
        Il <strong>launcher desktop</strong> funziona su macOS 12+, Linux (Ubuntu 22.04+, Debian 12+, Fedora 39+) e Windows 10+.
        Serve una connessione internet per le chiamate API agli agenti AI.
        Per alcuni workflow avanzati o di sviluppo possono servire dipendenze aggiuntive
        come <strong>tmux</strong>, CLI provider dedicate o <strong>WSL</strong> su Windows.
      </>
    ),
  },
  {
    q: 'I miei dati sono al sicuro?',
    a: (
      <>
        Si. Tutti i dati (database, CV, cover letter, profili) sono salvati nella cartella di lavoro
        locale sul tuo computer. Nessun dato viene inviato a server esterni, tranne le chiamate API
        ad Anthropic per far funzionare gli agenti. Le chiavi API sono salvate in una directory
        protetta (<code>~/.jht/secrets/</code>) e non vengono mai condivise o committate.
      </>
    ),
  },
  {
    q: 'Posso usare JHT senza chiave API?',
    a: (
      <>
        Si, ma con funzionalita limitate. Senza chiave API gli agenti AI non possono funzionare,
        pero puoi usare la web app per gestire candidature manualmente, consultare il profilo,
        e navigare la dashboard. Per la ricerca automatizzata serve una chiave Anthropic.
      </>
    ),
  },
  {
    q: 'Come contribuisco al progetto?',
    a: (
      <>
        JHT e open-source. Puoi contribuire su GitHub: segnala bug, proponi feature, o invia
        pull request. Consulta la <Link href="/docs" className="text-[var(--color-green)] hover:underline no-underline">documentazione tecnica</Link> per
        dettagli sull&apos;architettura e i moduli.
      </>
    ),
  },
]

function FaqAccordion({ item, isOpen, onToggle, index }: { item: FaqItem; isOpen: boolean; onToggle: () => void; index: number }) {
  const panelId = `faq-panel-${index}`
  const buttonId = `faq-btn-${index}`

  return (
    <div
      className="border-b border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.015)] rounded-sm"
      style={{ transition: 'background 0.2s', animation: `fade-in 0.35s ease ${index * 0.06}s both` }}
    >
      <button
        id={buttonId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-4 py-4 px-1 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] rounded"
        style={{ background: 'none', border: 'none', fontFamily: 'inherit' }}
      >
        <span className="text-[13px] font-semibold text-[var(--color-white)]">{item.q}</span>
        <span
          className="text-[var(--color-dim)] text-[14px] flex-shrink-0 transition-transform"
          aria-hidden="true"
          style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          +
        </span>
      </button>
      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="pb-4 px-1 text-[12px] text-[var(--color-muted)] leading-relaxed [&_code]:break-all [&_code]:text-[10px] sm:[&_code]:text-[11px]"
          style={{ animation: 'fade-in 0.15s ease both' }}
        >
          {item.a}
        </div>
      )}
    </div>
  )
}

function FaqJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item, i) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: FAQ_TEXTS[i] ?? '' },
    })),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
}

function FaqContent() {
  const { t } = useLandingI18n()
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <main style={{ position: 'relative', zIndex: 1 }}>
      <FaqJsonLd />
      <LandingNav />

      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Home</Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">FAQ</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">{t('faq_title')}</h1>
          <p className="text-[var(--color-muted)] text-[12px] mt-2 leading-relaxed">
            {t('faq_subtitle')}
          </p>
        </div>

        {/* FAQ list */}
        <FadeInSection>
          <div className="flex flex-col">
            {FAQ_ITEMS.map((item, i) => (
              <FaqAccordion
                key={i}
                item={item}
                index={i}
                isOpen={openIndex === i}
                onToggle={() => setOpenIndex(openIndex === i ? null : i)}
              />
            ))}
          </div>
        </FadeInSection>

        {/* CTA */}
        <FadeInSection delay={100}>
        <div className="mt-10 rounded-lg p-6 text-center" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <p className="text-[13px] text-[var(--color-bright)] font-semibold mb-2">{t('faq_no_answer')}</p>
          <p className="text-[11px] text-[var(--color-muted)] mb-4">
            {t('faq_no_answer_desc')}
          </p>
          <div className="flex items-center justify-center">
            <Link
              href="/docs"
              className="text-[11px] px-4 py-2 rounded-lg no-underline transition-all"
              style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)' }}
            >
              {t('faq_docs_btn')}
            </Link>
          </div>
        </div>
        </FadeInSection>

        {/* Footer nav */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-center">
          <Link href="/download"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            {t('nav_download')} &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  )
}

export default function FaqPage() {
  return (
    <LandingI18nProvider>
      <FaqContent />
    </LandingI18nProvider>
  )
}
