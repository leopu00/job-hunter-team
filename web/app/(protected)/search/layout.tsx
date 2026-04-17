import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ricerca — Job Hunter',
  description: 'Ricerca posizioni e aziende',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
