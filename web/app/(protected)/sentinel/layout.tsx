import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sentinel — Job Hunter',
  description: 'Monitoraggio anomalie',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
