import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Segnalibri — Job Hunter',
  description: 'Posizioni salvate',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
