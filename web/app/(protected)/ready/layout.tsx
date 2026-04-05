import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Pronte' }
export default function ReadyLayout({ children }: { children: React.ReactNode }) { return children }
