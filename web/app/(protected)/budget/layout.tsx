import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Budget — Job Hunter',
  description: 'Gestione budget candidature',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
