import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Overview',
}

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return children
}
