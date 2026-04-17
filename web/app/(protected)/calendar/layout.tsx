import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Calendario — Job Hunter',
  description: 'Calendario eventi e scadenze',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
