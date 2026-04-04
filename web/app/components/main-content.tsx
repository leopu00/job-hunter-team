'use client'

import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const PROTECTED_PREFIXES = [
  '/dashboard', '/profile', '/capitano', '/scout', '/analista',
  '/scorer', '/scrittore', '/critico', '/sentinella', '/team',
  '/applications', '/positions', '/ready', '/risposte', '/crescita',
  '/assistente', '/setup', '/download', '/about',
]

export default function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const hasSidebar = pathname !== '/' && !PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
  const marginLeft = hasSidebar && !isMobile ? 'var(--sidebar-w, 200px)' : 0

  return (
    <div id="main-content" tabIndex={-1} style={{ marginLeft, minHeight: '100vh', position: 'relative', zIndex: 1 }}>
      {children}
    </div>
  )
}
