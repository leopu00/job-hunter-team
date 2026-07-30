import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Migrazioni — Job Hunter',
  description: 'Gestione migrazioni database',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
