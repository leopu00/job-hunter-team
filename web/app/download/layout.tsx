import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Download',
  description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
  openGraph: {
    title: 'Download | Job Hunter Team',
    description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
  },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Download', path: '/download' }]} />{children}</>)
}
