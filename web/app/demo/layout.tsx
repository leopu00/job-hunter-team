import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Demo',
  description: 'Tour interattivo di Job Hunter Team: scopri come funziona il sistema multi-agente per la ricerca automatizzata di lavoro.',
  openGraph: {
    title: 'Demo | Job Hunter Team',
    description: 'Tour interattivo di Job Hunter Team: scopri come funziona il sistema multi-agente per la ricerca automatizzata di lavoro.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Demo Job Hunter Team' }],
  },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
