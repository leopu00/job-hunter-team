import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Variabili Ambiente — Job Hunter',
  description: "Gestione variabili d'ambiente",
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
