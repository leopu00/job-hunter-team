import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Domande frequenti su Job Hunter Team: come funziona, requisiti, privacy, costi e configurazione degli agenti AI.',
  openGraph: {
    title: 'FAQ | Job Hunter Team',
    description: 'Domande frequenti su Job Hunter Team: come funziona, requisiti, privacy, costi e configurazione degli agenti AI.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'FAQ Job Hunter Team' }],
  },
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return children
}
