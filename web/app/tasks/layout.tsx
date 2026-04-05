import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Task — Job Hunter',
  description: 'Gestione task e attività',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
