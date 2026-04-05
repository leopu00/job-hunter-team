import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Scheduler — Job Hunter',
  description: 'Pianificazione job automatici',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
