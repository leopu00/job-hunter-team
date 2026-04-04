import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy policy di Job Hunter Team: dati locali, nessun tracciamento, chiavi API sicure, open source.',
  openGraph: {
    title: 'Privacy Policy | Job Hunter Team',
    description: 'Privacy policy di Job Hunter Team: dati locali, nessun tracciamento, chiavi API sicure, open source.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Privacy Job Hunter Team' }],
  },
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children
}
