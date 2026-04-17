import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Audit — Job Hunter',
  description: 'Log audit e sicurezza',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
