import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Workers',
}

export default function WorkersLayout({ children }: { children: React.ReactNode }) {
  return children
}
