import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Piani e prezzi di Job Hunter Team: Free, Pro ed Enterprise. Confronta funzionalita e scegli il piano adatto a te.',
  openGraph: {
    title: 'Pricing | Job Hunter Team',
    description: 'Piani e prezzi di Job Hunter Team: Free, Pro ed Enterprise. Confronta funzionalita e scegli il piano adatto a te.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function PricingJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Job Hunter Team',
    description: 'Sistema multi-agente AI per ricerca e candidatura automatizzata. Open source, locale, privato.',
    url: `${SITE_URL}/pricing`,
    brand: { '@type': 'Organization', name: 'Job Hunter Team' },
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'EUR',
        description: 'Per iniziare a cercare lavoro con gli agenti AI.',
        url: `${SITE_URL}/download`,
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '19',
        priceCurrency: 'EUR',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: '19', priceCurrency: 'EUR', unitText: 'MONTH' },
        description: 'Per chi cerca lavoro seriamente e vuole risultati veloci.',
        url: `${SITE_URL}/download`,
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (<><PricingJsonLd /><BreadcrumbJsonLd items={[{ name: 'Pricing', path: '/pricing' }]} />{children}</>)
}
