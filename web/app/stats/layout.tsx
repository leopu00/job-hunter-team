import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Statistiche',
  description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  openGraph: {
    title: 'Statistiche | Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  },
  twitter: {
    card: 'summary',
    title: 'Statistiche | Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Statistiche', path: '/stats' }]} />{children}</>)
}
