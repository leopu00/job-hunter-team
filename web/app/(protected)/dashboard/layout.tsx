import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Dashboard', description: 'Overview of your job search progress and agent activities.' }
export default function DashboardLayout({ children }: { children: React.ReactNode }) { return children }
