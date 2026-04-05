import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Segreti — Job Hunter',
  description: 'Gestione chiavi API e segreti',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
