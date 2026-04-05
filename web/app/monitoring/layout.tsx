import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Monitoring',
}

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return children
}
