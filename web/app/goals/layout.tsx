import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Obiettivi — Job Hunter',
  description: 'Gestione obiettivi di ricerca lavoro',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
