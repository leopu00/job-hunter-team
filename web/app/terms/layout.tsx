import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Termini di Servizio',
  description: 'Termini e condizioni di utilizzo di Job Hunter Team.',
  openGraph: {
    title: 'Termini di Servizio | Job Hunter Team',
    description: 'Termini e condizioni di utilizzo di Job Hunter Team.',
  },
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children
}
