import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Profile', description: 'Candidate profile: avatar, skills, experience, CV and completion statistics.' }
export default function ProfileLayout({ children }: { children: React.ReactNode }) { return children }
