import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'API Explorer' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
