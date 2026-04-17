import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Insights — Job Hunter',
  description: 'Analisi e approfondimenti sulla ricerca lavoro',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
