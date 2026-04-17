import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Importazione — Job Hunter',
  description: 'Importazione dati esterni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
