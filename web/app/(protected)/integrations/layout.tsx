import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Integrazioni — Job Hunter',
  description: 'Gestione integrazioni esterne',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
