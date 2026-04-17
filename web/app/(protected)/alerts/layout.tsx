import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Alert',
}

export default function AlertsLayout({ children }: { children: React.ReactNode }) {
  return children
}
