import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Networking — Job Hunter',
  description: 'Gestione rete professionale',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
