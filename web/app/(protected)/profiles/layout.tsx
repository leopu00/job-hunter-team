import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Profili — Job Hunter',
  description: 'Gestione profili candidato',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
