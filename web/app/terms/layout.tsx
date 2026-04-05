import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Termini di Servizio',
  description: 'Termini e condizioni di utilizzo di Job Hunter Team.',
  openGraph: {
    title: 'Termini di Servizio | Job Hunter Team',
    description: 'Termini e condizioni di utilizzo di Job Hunter Team.',
  },
  twitter: {
    card: 'summary',
    title: 'Termini di Servizio | Job Hunter Team',
    description: 'Termini e condizioni di utilizzo di Job Hunter Team.',
  },
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Termini di Servizio', path: '/terms' }]} />{children}</>)
}
