'use client'

import { usePathname } from 'next/navigation'

const PROTECTED_PREFIXES = [
  '/dashboard', '/profile', '/capitano', '/scout', '/analista',
  '/scorer', '/scrittore', '/critico', '/sentinella', '/team',
  '/applications', '/positions', '/ready', '/risposte', '/crescita',
  '/assistente', '/setup',
]

export default function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hasSidebar = pathname !== '/' && !PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
  return (
    <div id="main-content" tabIndex={-1} style={{ marginLeft: hasSidebar ? 200 : 0, minHeight: '100vh', position: 'relative', zIndex: 1 }}>
      {children}
    </div>
  )
}
