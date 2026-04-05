import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Rate Limiter — Job Hunter',
  description: 'Controllo limiti richieste',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
