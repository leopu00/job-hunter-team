import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contatti — Job Hunter',
  description: 'Rubrica contatti professionali',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
