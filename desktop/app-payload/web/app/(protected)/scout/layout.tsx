import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Scout', description: 'Agente Scout: cerca nuove offerte di lavoro su LinkedIn, Indeed e altre piattaforme.' }
export default function ScoutLayout({ children }: { children: React.ReactNode }) { return children }
