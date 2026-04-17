import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Performance — Job Hunter',
  description: 'Metriche prestazioni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
