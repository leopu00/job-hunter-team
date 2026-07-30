import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Errori — Job Hunter',
  description: 'Log errori sistema',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
