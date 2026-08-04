import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Statistiche',
  description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  openGraph: {
    title: 'Statistiche | Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  },
  twitter: {
    card: 'summary',
    title: 'Statistiche | Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function StatsJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Statistiche — Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team.',
    url: `${SITE_URL}/stats`,
    isPartOf: { '@type': 'WebSite', name: 'Job Hunter Team', url: SITE_URL },
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Statistiche', path: '/stats' }]} /><StatsJsonLd />{children}</>)
}
