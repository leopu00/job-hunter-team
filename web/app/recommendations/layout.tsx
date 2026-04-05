import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Raccomandazioni — Job Hunter',
  description: 'Suggerimenti posizioni lavorative',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
