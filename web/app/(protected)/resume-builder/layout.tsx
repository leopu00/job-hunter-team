import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Resume Builder — Job Hunter',
  description: 'Costruttore curriculum',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
