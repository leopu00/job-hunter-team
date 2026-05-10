import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Database',
}

export default function DatabaseLayout({ children }: { children: React.ReactNode }) {
  return children
}
