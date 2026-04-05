import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team: nuove feature, fix e miglioramenti versione per versione.',
  openGraph: {
    title: 'Changelog | Job Hunter Team',
    description: 'Tutte le novita e gli aggiornamenti di Job Hunter Team: nuove feature, fix e miglioramenti.',
  },
}

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children
}
