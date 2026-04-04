import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Download',
  description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
  openGraph: {
    title: 'Download | Job Hunter Team',
    description: 'Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Download Job Hunter Team' }],
  },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children
}
