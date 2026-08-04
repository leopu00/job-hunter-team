import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Archivio — Job Hunter',
  description: 'Archivio candidature e posizioni',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
