import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Confronto' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
