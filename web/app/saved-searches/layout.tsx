import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ricerche Salvate — Job Hunter',
  description: 'Gestione ricerche salvate',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
