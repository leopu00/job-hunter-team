import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Documentazione',
  description: 'Documentazione tecnica di Job Hunter Team: architettura, moduli condivisi, comandi CLI e API routes.',
  openGraph: {
    title: 'Documentazione | Job Hunter Team',
    description: 'Documentazione tecnica di Job Hunter Team: architettura, moduli condivisi, comandi CLI e API routes.',
  },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children
}
