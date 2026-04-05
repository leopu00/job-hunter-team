import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Git' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
