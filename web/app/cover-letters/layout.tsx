import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Lettere di Presentazione — Job Hunter',
  description: 'Gestione cover letter',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
