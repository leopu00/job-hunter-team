import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Scout', description: 'Scout Agent: searches for new opportunities on job channels.' }
export default function ScoutLayout({ children }: { children: React.ReactNode }) { return children }
