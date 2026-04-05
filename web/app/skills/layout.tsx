import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Competenze — Job Hunter',
  description: 'Gestione competenze',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
