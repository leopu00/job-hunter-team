import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Stato — Job Hunter',
  description: 'Stato servizi e componenti',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
