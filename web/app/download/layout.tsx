import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Download',
  description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
  openGraph: {
    title: 'Download | Job Hunter Team',
    description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function DownloadJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Job Hunter Team',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'macOS, Linux, Windows',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: `${SITE_URL}/download`,
    softwareVersion: '0.1.0',
    description: 'Un team di agenti AI che automatizza la ricerca di lavoro. Open source, locale, privato.',
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Download', path: '/download' }]} /><DownloadJsonLd />{children}</>)
}
