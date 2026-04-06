import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Guida',
  description: 'Guida completa a Job Hunter Team: installazione, configurazione TUI, interfaccia web e gestione degli agenti.',
  openGraph: {
    title: 'Guida | Job Hunter Team',
    description: 'Guida completa a Job Hunter Team: installazione, configurazione TUI, interfaccia web e gestione degli agenti.',
  },
  twitter: {
    card: 'summary',
    title: 'Guida | Job Hunter Team',
    description: 'Guida completa a Job Hunter Team: installazione, configurazione TUI, interfaccia web e gestione degli agenti.',
  },
}

function GuideJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'Come installare e configurare Job Hunter Team',
    description: 'Guida passo-passo per installare Job Hunter Team con il launcher desktop, configurare la TUI e avviare la web app.',
    step: [
      { '@type': 'HowToStep', name: 'Scarica il launcher desktop', text: 'Vai alla pagina /download e scarica il pacchetto .dmg, .exe, .AppImage o .deb adatto al tuo sistema operativo.' },
      { '@type': 'HowToStep', name: 'Installa e avvia', text: 'Apri il launcher desktop e completa il bootstrap iniziale per aprire la dashboard locale.' },
      { '@type': 'HowToStep', name: 'Configura la API key', text: 'Imposta la chiave Anthropic tramite la pagina di setup o il file di configurazione.' },
      { '@type': 'HowToStep', name: 'Avvia il team', text: 'Dalla dashboard apri la pagina Team, oppure usa la TUI se preferisci una gestione da terminale.' },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Guida', path: '/guide' }]} /><GuideJsonLd />{children}</>)
}
