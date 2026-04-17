import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Notifiche — Job Hunter',
  description: 'Centro notifiche',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
