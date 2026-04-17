import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Plugin',
}

export default function PluginsLayout({ children }: { children: React.ReactNode }) {
  return children
}
