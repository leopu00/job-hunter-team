import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Promemoria — Job Hunter',
  description: 'Gestione promemoria',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
