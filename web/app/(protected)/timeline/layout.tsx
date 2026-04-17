import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Timeline — Job Hunter',
  description: 'Timeline candidature',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
