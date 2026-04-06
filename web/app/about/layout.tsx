import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'About',
  description: 'Chi siamo, la storia del progetto, i 7 agenti core piu un assistente di supporto e la visione futura di Job Hunter Team.',
  openGraph: {
    title: 'About | Job Hunter Team',
    description: 'Chi siamo, la storia del progetto, i 7 agenti core piu un assistente di supporto e la visione futura di Job Hunter Team.',
  },
  twitter: {
    card: 'summary',
    title: 'About | Job Hunter Team',
    description: 'Chi siamo, la storia del progetto, i 7 agenti core piu un assistente di supporto e la visione futura di Job Hunter Team.',
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
    description: 'Un team di agenti AI che automatizza la ricerca di lavoro. Open source, locale, privato.',
    sameAs: ['https://github.com/leopu00/job-hunter-team'],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'About', path: '/about' }]} /><AboutJsonLd />{children}</>)
}
