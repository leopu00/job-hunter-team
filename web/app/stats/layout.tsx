import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Statistiche',
  description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  openGraph: {
    title: 'Statistiche | Job Hunter Team',
    description: 'Metriche in tempo reale del progetto Job Hunter Team: commit, agenti, API routes, test e attivita settimanale.',
  },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children
}
