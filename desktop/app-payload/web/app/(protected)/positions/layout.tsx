import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Posizioni', description: 'Tutte le posizioni trovate dagli agenti: dettagli, score, stato e link alle offerte originali.' }
export default function PositionsLayout({ children }: { children: React.ReactNode }) { return children }
