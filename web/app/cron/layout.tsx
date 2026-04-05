import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cron — Job Hunter',
  description: 'Gestione job schedulati',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
