import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Memoria — Job Hunter',
  description: 'Memoria persistente agenti',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
