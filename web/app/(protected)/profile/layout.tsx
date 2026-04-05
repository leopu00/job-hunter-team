import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Profilo', description: 'Profilo candidato: avatar, competenze, esperienza, CV e statistiche di completamento.' }
export default function ProfileLayout({ children }: { children: React.ReactNode }) { return children }
