import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contesto — Job Hunter',
  description: 'Gestione contesto conversazione',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
