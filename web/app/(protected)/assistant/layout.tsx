import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Assistente — Job Hunter',
  description: 'Assistente AI per la ricerca lavoro',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
