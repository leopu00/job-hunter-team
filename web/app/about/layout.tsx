import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'About',
  description: 'About us, the project history, the 7 core agents plus a support assistant, and the future vision of Job Hunter Team.',
  openGraph: {
    title: 'About | Job Hunter Team',
    description: 'About us, the project history, the 7 core agents plus a support assistant, and the future vision of Job Hunter Team.',
  },
  twitter: {
    card: 'summary',
    title: 'About | Job Hunter Team',
    description: 'About us, the project history, the 7 core agents plus a support assistant, and the future vision of Job Hunter Team.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function AboutJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Job Hunter Team',
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
    description: 'A team of AI agents that automates job searching. Open source, local, private.',
    sameAs: ['https://github.com/leopu00/job-hunter-team'],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'About', path: '/about' }]} /><AboutJsonLd />{children}</>)
}
