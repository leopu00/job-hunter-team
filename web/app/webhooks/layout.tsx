import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Webhook — Job Hunter',
  description: 'Gestione webhook',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
