import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Demo',
  description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  openGraph: {
    title: 'Demo | Job Hunter Team',
    description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  },
  twitter: {
    card: 'summary',
    title: 'Demo | Job Hunter Team',
    description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function DemoJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Demo — Job Hunter Team',
    description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente.',
    url: `${SITE_URL}/demo`,
    isPartOf: { '@type': 'WebSite', name: 'Job Hunter Team', url: SITE_URL },
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Demo', path: '/demo' }]} /><DemoJsonLd />{children}</>)
}
