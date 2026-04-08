import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

export const metadata: Metadata = {
  title: 'Progetto',
  description: 'Panoramica pubblica del progetto Job Hunter Team: obiettivo, repository, stack e architettura open source.',
  openGraph: {
    title: 'Progetto | Job Hunter Team',
    description: 'Panoramica pubblica del progetto Job Hunter Team: obiettivo, repository, stack e architettura open source.',
  },
  twitter: {
    card: 'summary',
    title: 'Progetto | Job Hunter Team',
    description: 'Panoramica pubblica del progetto Job Hunter Team: obiettivo, repository, stack e architettura open source.',
  },
}

function ProjectJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Progetto - Job Hunter Team',
    description: 'Panoramica pubblica del progetto Job Hunter Team.',
    url: `${SITE_URL}/project`,
    isPartOf: { '@type': 'WebSite', name: 'Job Hunter Team', url: SITE_URL },
  }

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: 'Progetto', path: '/project' }]} />
      <ProjectJsonLd />
      {children}
    </>
  )
}
