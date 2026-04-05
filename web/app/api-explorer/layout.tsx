import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'API Explorer — Job Hunter',
  description: 'Esplorazione endpoint API',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
