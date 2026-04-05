import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Forum — Job Hunter',
  description: 'Forum comunicazione team',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
