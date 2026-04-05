import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Sentinella', description: 'Agente Sentinella: monitora email e notifiche per risposte dalle aziende alle candidature.' }
export default function SentinellaLayout({ children }: { children: React.ReactNode }) { return children }
