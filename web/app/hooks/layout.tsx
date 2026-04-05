import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Hooks — Job Hunter',
  description: 'Gestione hook eventi',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
