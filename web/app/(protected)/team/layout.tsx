import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Team',
  description: 'Gestisci il tuo team di agenti AI: avvia, monitora e coordina Scout, Analista, Scorer, Scrittore e gli altri.',
  openGraph: {
    title: 'Team | Job Hunter Team',
    description: 'Gestisci il tuo team di agenti AI: avvia, monitora e coordina Scout, Analista, Scorer, Scrittore e gli altri.',
  },
}

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children
}
