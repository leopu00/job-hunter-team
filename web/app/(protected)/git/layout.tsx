import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Git — Job Hunter',
  description: 'Stato repository Git',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
