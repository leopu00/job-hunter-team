import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Demo',
  description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  openGraph: {
    title: 'Demo | Job Hunter Team',
    description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  },
  twitter: {
    card: 'summary',
    title: 'Demo | Job Hunter Team',
    description: 'Tour guidato di Job Hunter Team: scopri come funziona il sistema multi-agente dall\'installazione ai risultati.',
  },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
