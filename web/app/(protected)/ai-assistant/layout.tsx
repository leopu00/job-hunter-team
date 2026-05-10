import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Assistant — Job Hunter',
  description: 'Assistente intelligenza artificiale',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
