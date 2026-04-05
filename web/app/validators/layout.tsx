import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Validatori — Job Hunter',
  description: 'Validazione dati e regole',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
