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
    description: 'Guida passo-passo per installare Job Hunter Team, configurare la TUI e avviare la web app.',
    step: [
      { '@type': 'HowToStep', name: 'Installa i prerequisiti', text: 'Assicurati di avere Node.js 18+, Python 3.10+ e tmux installati.' },
      { '@type': 'HowToStep', name: 'Clona il repository', text: 'git clone https://github.com/leopu00/job-hunter-team && cd job-hunter-team' },
      { '@type': 'HowToStep', name: 'Configura la API key', text: 'Imposta la chiave Anthropic tramite la pagina di setup o il file di configurazione.' },
      { '@type': 'HowToStep', name: 'Avvia il team', text: 'Lancia la TUI con ./start.sh oppure avvia la web app con npm run dev.' },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Guida', path: '/guide' }]} /><GuideJsonLd />{children}</>)
}
