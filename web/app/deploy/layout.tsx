import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Deploy — Job Hunter',
  description: 'Gestione deployment',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
