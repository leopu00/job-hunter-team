import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Colloqui — Job Hunter',
  description: 'Gestione colloqui',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
