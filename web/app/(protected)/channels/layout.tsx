import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Canali — Job Hunter',
  description: 'Gestione canali comunicazione',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
