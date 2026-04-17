import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Messages — Job Hunter',
  description: 'Message management and communications',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
