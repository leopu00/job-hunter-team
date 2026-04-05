import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Template — Job Hunter',
  description: 'Gestione template documenti',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
