import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Guida',
  description: 'Guida completa a Job Hunter Team: installazione, configurazione TUI, interfaccia web e gestione degli agenti.',
  openGraph: {
    title: 'Guida | Job Hunter Team',
    description: 'Guida completa a Job Hunter Team: installazione, configurazione TUI, interfaccia web e gestione degli agenti.',
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children
}
