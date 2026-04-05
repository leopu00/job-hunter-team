import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Eventi',
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children
}
