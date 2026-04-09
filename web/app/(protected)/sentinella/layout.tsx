import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Sentinel', description: 'Sentinel Agent: monitors budget, limits and system health.' }
export default function SentinellaLayout({ children }: { children: React.ReactNode }) { return children }
