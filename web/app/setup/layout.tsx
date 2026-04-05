import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Setup',
  description: 'Configurazione iniziale di Job Hunter Team: provider AI, API key, workspace e health check.',
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children
}
