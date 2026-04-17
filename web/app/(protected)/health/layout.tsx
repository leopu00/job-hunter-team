import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Salute Sistema — Job Hunter',
  description: 'Stato di salute servizi',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
