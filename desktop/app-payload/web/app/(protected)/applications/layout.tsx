import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Candidature', description: 'Tutte le candidature: inviate, pronte, in lavorazione. CV, cover letter e stato di ogni application.' }
export default function ApplicationsLayout({ children }: { children: React.ReactNode }) { return children }
