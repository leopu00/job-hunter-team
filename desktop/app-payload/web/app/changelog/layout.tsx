import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team: nuove feature, fix e miglioramenti versione per versione.',
  openGraph: {
    title: 'Changelog | Job Hunter Team',
    description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team: nuove feature, fix e miglioramenti.',
  },
  twitter: {
    card: 'summary',
    title: 'Changelog | Job Hunter Team',
    description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team: nuove feature, fix e miglioramenti.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function ChangelogJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Changelog — Job Hunter Team',
    description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team.',
    url: `${SITE_URL}/changelog`,
    isPartOf: { '@type': 'WebSite', name: 'Job Hunter Team', url: SITE_URL },
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Changelog', path: '/changelog' }]} /><ChangelogJsonLd />{children}</>)
}
