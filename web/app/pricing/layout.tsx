import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Job Hunter Team plans and pricing: Free, Pro, and Enterprise. Compare features and choose the plan that fits you.',
  openGraph: {
    title: 'Pricing | Job Hunter Team',
    description: 'Job Hunter Team plans and pricing: Free, Pro, and Enterprise. Compare features and choose the plan that fits you.',
  },
  twitter: {
    card: 'summary',
    title: 'Pricing | Job Hunter Team',
    description: 'Job Hunter Team plans and pricing: Free, Pro, and Enterprise. Compare features and choose the plan that fits you.',
  },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

function PricingJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Job Hunter Team',
    description: 'Multi-agent AI system for automated job search and applications. Open source, local, private.',
    url: `${SITE_URL}/pricing`,
    brand: { '@type': 'Organization', name: 'Job Hunter Team' },
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'EUR',
        description: 'Start searching for jobs with AI agents.',
        url: `${SITE_URL}/download`,
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '19',
        priceCurrency: 'EUR',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: '19', priceCurrency: 'EUR', unitText: 'MONTH' },
        description: 'For serious job seekers who want fast results.',
        url: `${SITE_URL}/download`,
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (<><PricingJsonLd /><BreadcrumbJsonLd items={[{ name: 'Pricing', path: '/pricing' }]} />{children}</>)
}
