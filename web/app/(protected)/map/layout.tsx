import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mappa — Job Hunter',
  description: 'Mappa geografica posizioni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
