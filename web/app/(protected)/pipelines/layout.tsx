import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pipeline — Job Hunter',
  description: 'Pipeline di elaborazione',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
