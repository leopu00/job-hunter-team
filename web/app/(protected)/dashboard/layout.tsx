import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Dashboard', description: 'Panoramica generale: KPI candidature, posizioni attive e attività recente del team AI.' }
export default function DashboardLayout({ children }: { children: React.ReactNode }) { return children }
