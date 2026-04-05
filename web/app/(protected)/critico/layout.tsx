import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Critico', description: 'Agente Critico: revisiona CV e cover letter, assegna punteggi e verdict di qualità.' }
export default function CriticoLayout({ children }: { children: React.ReactNode }) { return children }
