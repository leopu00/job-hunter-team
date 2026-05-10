import type { Metadata } from 'next'
import BreadcrumbJsonLd from '../../components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Report',
  description: 'Report candidature Job Hunter Team: KPI, andamento mensile, tempi per fase e top aziende per periodo.',
  openGraph: {
    title: 'Report | Job Hunter Team',
    description: 'Report candidature Job Hunter Team: KPI, andamento mensile, tempi per fase e top aziende.',
  },
  twitter: {
    card: 'summary',
    title: 'Report | Job Hunter Team',
    description: 'Report candidature Job Hunter Team: KPI, andamento mensile, tempi per fase e top aziende.',
  },
}

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (<><BreadcrumbJsonLd items={[{ name: 'Report', path: '/reports' }]} />{children}</>)
}
