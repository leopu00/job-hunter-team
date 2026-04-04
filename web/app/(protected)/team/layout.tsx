import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Team',
  description: 'Gestisci il tuo team di agenti AI: avvia, monitora e coordina Scout, Analista, Scorer, Scrittore e gli altri.',
  openGraph: {
    title: 'Team | Job Hunter Team',
    description: 'Gestisci il tuo team di agenti AI: avvia, monitora e coordina Scout, Analista, Scorer, Scrittore e gli altri.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Team Job Hunter Team' }],
  },
}

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children
}
