import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Automazioni — Job Hunter',
  description: 'Gestione automazioni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
