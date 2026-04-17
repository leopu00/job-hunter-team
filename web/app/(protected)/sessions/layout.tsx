import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sessioni — Job Hunter',
  description: 'Gestione sessioni agenti',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
