import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Team',
  description: 'Manage your AI agent team: start, monitor and coordinate Scout, Analyst, Scorer, Writer and others.',
  openGraph: {
    title: 'Team | Job Hunter Team',
    description: 'Manage your AI agent team: start, monitor and coordinate Scout, Analyst, Scorer, Writer and others.',
  },
}

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children
}
