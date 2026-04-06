import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Guida',
  description: 'Guida completa a Job Hunter Team: installazione con launcher desktop, dashboard locale, configurazione e strumenti avanzati.',
  openGraph: {
    title: 'Guida | Job Hunter Team',
    description: 'Guida completa a Job Hunter Team: installazione con launcher desktop, dashboard locale, configurazione e strumenti avanzati.',
  },
  twitter: {
    card: 'summary',
    title: 'Guida | Job Hunter Team',
    description: 'Guida completa a Job Hunter Team: installazione con launcher desktop, dashboard locale, configurazione e strumenti avanzati.',
  },
}

function GuideJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'Come installare e configurare Job Hunter Team',
    description: 'Guida passo-passo per installare Job Hunter Team con il launcher desktop, completare il setup iniziale e usare la dashboard locale.',
    step: [
      { '@type': 'HowToStep', name: 'Scarica il launcher desktop', text: 'Vai alla pagina /download e scarica il pacchetto .dmg, .exe, .AppImage o .deb adatto al tuo sistema operativo.' },
      { '@type': 'HowToStep', name: 'Installa e avvia', text: 'Apri il launcher desktop e completa il bootstrap iniziale per aprire la dashboard locale.' },
      { '@type': 'HowToStep', name: 'Configura il setup iniziale', text: 'Seleziona la cartella di lavoro e configura le credenziali dei provider che vuoi usare.' },
      { '@type': 'HowToStep', name: 'Avvia il team', text: 'Dalla dashboard locale apri la pagina Team e avvia gli agenti necessari.' },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Guida', path: '/guide' }]} /><GuideJsonLd />{children}</>)
}
