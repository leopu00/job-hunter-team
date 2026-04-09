import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Positions', description: 'Browse and manage job positions found by the Scout agent.' }
export default function PositionsLayout({ children }: { children: React.ReactNode }) { return children }
