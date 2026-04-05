import type { Metadata } from 'next'
import FaqJsonLd from './FaqJsonLd'

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Domande frequenti su Job Hunter Team: come funziona, requisiti, privacy, costi e configurazione degli agenti AI.',
  openGraph: {
    title: 'FAQ | Job Hunter Team',
    description: 'Domande frequenti su Job Hunter Team: come funziona, requisiti, privacy, costi e configurazione degli agenti AI.',
  },
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FaqJsonLd />
      {children}
    </>
  )
}
