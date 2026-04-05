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

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Pricing', path: '/pricing' }]} />{children}</>)
}
