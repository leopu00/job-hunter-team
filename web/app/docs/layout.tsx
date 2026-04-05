import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Documentazione',
  description: 'Documentazione tecnica di Job Hunter Team: architettura, API, moduli, agenti e configurazione del sistema multi-agente.',
  openGraph: {
    title: 'Documentazione | Job Hunter Team',
    description: 'Documentazione tecnica di Job Hunter Team: architettura, API, moduli, agenti e configurazione del sistema multi-agente.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Documentazione Job Hunter Team' }],
  },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children
}
