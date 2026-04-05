import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Documentazione',
  description: 'Documentazione tecnica di Job Hunter Team: architettura, moduli condivisi, comandi CLI e API routes.',
  openGraph: {
    title: 'Documentazione | Job Hunter Team',
    description: 'Documentazione tecnica di Job Hunter Team: architettura, moduli condivisi, comandi CLI e API routes.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function DocsJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: 'Documentazione tecnica — Job Hunter Team',
    description: 'Architettura, moduli condivisi, comandi CLI e API routes di Job Hunter Team.',
    url: `${SITE_URL}/docs`,
    author: { '@type': 'Organization', name: 'Job Hunter Team' },
    publisher: { '@type': 'Organization', name: 'Job Hunter Team' },
    inLanguage: 'it',
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Documentazione', path: '/docs' }]} /><DocsJsonLd />{children}</>)
}
