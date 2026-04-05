import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Aziende — Job Hunter',
  description: 'Database aziende',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
