import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Onboarding — Job Hunter',
  description: 'Configurazione iniziale',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
