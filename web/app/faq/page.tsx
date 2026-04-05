'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

type FaqItem = { q: string; a: React.ReactNode }

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
        Puoi seguire il lavoro dalla web app o dalla TUI (terminale).
      </>
    ),
  },
  {
    q: 'Serve creare un account?',
    a: (
      <>
        No. JHT gira interamente in locale. Non c&apos;e registrazione, non c&apos;e login
        a servizi esterni, non c&apos;e cloud. Avvii il server sul tuo computer e accedi
        dal browser su <code>localhost:3000</code>.
      </>
    ),
  },
  {
    q: 'Quanto costa?',
    a: (
      <>
        Il software e gratuito e open-source. L&apos;unico costo e la chiave API Anthropic
        per far funzionare gli agenti AI (Claude). Una ricerca completa tipica consuma circa
        1-5$ di API a seconda del volume di offerte. La Sentinella monitora i costi in tempo
        reale e puoi impostare un budget massimo. Senza chiave API puoi comunque usare la
        dashboard e gestire candidature manualmente.
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
        <strong>Dalla web app:</strong> vai su{' '}
        <Link href="/team" className="text-[var(--color-green)] hover:underline no-underline">/team</Link>{' '}
        e premi &quot;Avvia Team&quot;. Servono: una cartella di lavoro configurata,{' '}
        <code>tmux</code> installato, e <code>Claude CLI</code> con una chiave API Anthropic.
        <br /><br />
        <strong>Dalla TUI:</strong> avvia con <code>cd tui &amp;&amp; npm run dev</code>,
        poi usa il comando <code>/start &lt;agente&gt;</code> per avviare i singoli agenti,
        oppure avviali tutti dalla vista Team.
        <br /><br />
        Consulta la <Link href="/guide" className="text-[var(--color-green)] hover:underline no-underline">guida</Link> per
        istruzioni dettagliate.
      </>
    ),
  },
  {
    q: 'Quali sono i requisiti di sistema?',
    a: (
      <>
        <strong>Node.js 18+</strong>, <strong>tmux</strong> (per gli agenti),
        e <strong>Claude CLI</strong> (<code>npm i -g @anthropic-ai/claude-code</code>).
        Funziona su macOS 12+, Linux (Ubuntu 20.04+, Fedora 36+) e Windows 10+ (con WSL per tmux).
        Serve una connessione internet per le chiamate API agli agenti AI.
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
      className="border-b border-[var(--color-border)]"
      style={{ transition: 'background 0.2s' }}
    >
      <button
        id={buttonId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-4 py-4 px-1 cursor-pointer text-left"
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

function FaqContent() {
  const { t } = useLandingI18n()
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <main style={{ position: 'relative', zIndex: 1 }}>
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

        {/* CTA */}
        <div className="mt-10 rounded-lg p-6 text-center" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <p className="text-[13px] text-[var(--color-bright)] font-semibold mb-2">{t('faq_no_answer')}</p>
          <p className="text-[11px] text-[var(--color-muted)] mb-4">
            {t('faq_no_answer_desc')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/guide"
              className="text-[11px] px-4 py-2 rounded-lg no-underline transition-all"
              style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)' }}
            >
              {t('faq_guide_btn')}
            </Link>
            <Link
              href="/docs"
              className="text-[11px] px-4 py-2 rounded-lg no-underline transition-all"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-dim)' }}
            >
              {t('faq_docs_btn')}
            </Link>
          </div>
        </div>

        {/* Footer nav */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/guide"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; {t('nav_guide')}
          </Link>
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
