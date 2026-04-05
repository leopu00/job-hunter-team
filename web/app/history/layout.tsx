import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cronologia — Job Hunter',
  description: 'Cronologia azioni e modifiche',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
