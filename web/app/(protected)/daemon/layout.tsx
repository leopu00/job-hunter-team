import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Daemon — Job Hunter',
  description: 'Gestione processi daemon',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
