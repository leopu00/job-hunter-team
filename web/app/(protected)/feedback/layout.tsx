import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Feedback — Job Hunter',
  description: 'Gestione feedback',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
