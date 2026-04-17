import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Confronto — Job Hunter',
  description: 'Confronto posizioni lavorative',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
