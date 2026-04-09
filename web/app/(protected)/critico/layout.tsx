import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Critic', description: 'Critic Agent: reviews materials and flags what needs to be corrected.' }
export default function CriticoLayout({ children }: { children: React.ReactNode }) { return children }
