'use client'

import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

const PROTECTED_PREFIXES = [
  '/dashboard', '/profile', '/capitano', '/scout', '/analista',
  '/scorer', '/scrittore', '/critico', '/sentinella', '/team',
  '/applications', '/positions', '/ready', '/risposte', '/crescita',
  '/assistente', '/setup', '/download', '/about', '/demo', '/pricing', '/privacy',
]

export default function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isMobile, setIsMobile] = useState(false)
  const [fade, setFade] = useState(false)
  const prevPath = useRef(pathname)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (pathname !== prevPath.current) {
      setFade(true)
      prevPath.current = pathname
      const t = setTimeout(() => setFade(false), 200)
      return () => clearTimeout(t)
    }
  }, [pathname])

  const hasSidebar = pathname !== '/' && !PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
  const marginLeft = hasSidebar && !isMobile ? 'var(--sidebar-w, 200px)' : 0

  return (
    <div id="main-content" tabIndex={-1} style={{
      marginLeft, minHeight: '100vh', position: 'relative', zIndex: 1,
      opacity: fade ? 0 : 1, transform: fade ? 'translateY(4px)' : 'translateY(0)',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
    }}>
      {children}
    </div>
  )
}
