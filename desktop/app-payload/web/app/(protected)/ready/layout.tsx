import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Pronte', description: 'Candidature pronte all\'invio: CV e cover letter generati, revisione superata, documenti su Drive.' }
export default function ReadyLayout({ children }: { children: React.ReactNode }) { return children }
