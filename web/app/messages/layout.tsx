import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Messaggi — Job Hunter',
  description: 'Gestione messaggi e comunicazioni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
