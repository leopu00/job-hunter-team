import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Attività — Job Hunter',
  description: 'Log attività e timeline',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
