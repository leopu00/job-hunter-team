import type { Metadata } from 'next'
import FaqJsonLd from './FaqJsonLd'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Frequently asked questions about Job Hunter Team: how it works, requirements, privacy, costs, and AI agent configuration.',
  openGraph: {
    title: 'FAQ | Job Hunter Team',
    description: 'Frequently asked questions about Job Hunter Team: how it works, requirements, privacy, costs, and AI agent configuration.',
  },
  twitter: {
    card: 'summary',
    title: 'FAQ | Job Hunter Team',
    description: 'Frequently asked questions about Job Hunter Team: how it works, requirements, privacy, costs, and AI agent configuration.',
  },
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FaqJsonLd />
      <BreadcrumbJsonLd items={[{ name: 'FAQ', path: '/faq' }]} />
      {children}
    </>
  )
}
