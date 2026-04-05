import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'About',
  description: 'Chi siamo, la storia del progetto, il team di 8 agenti AI specializzati e la visione futura di Job Hunter Team.',
  openGraph: {
    title: 'About | Job Hunter Team',
    description: 'Chi siamo, la storia del progetto, il team di 8 agenti AI specializzati e la visione futura di Job Hunter Team.',
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'About', path: '/about' }]} />{children}</>)
}
