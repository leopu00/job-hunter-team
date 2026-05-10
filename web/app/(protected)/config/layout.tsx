import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Configurazione — Job Hunter',
  description: 'Configurazione sistema',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
