import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Retry — Job Hunter',
  description: 'Gestione retry e dead-letter queue',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
