import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Strumenti — Job Hunter',
  description: 'Strumenti e utility',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
