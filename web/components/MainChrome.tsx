'use client'

import { usePathname } from 'next/navigation'

// Routes che occupano tutta la viewport — senza il wrapper `max-w-6xl`
// del protected layout. Sono i flussi bloccanti (onboarding) o le dashboard
// che gestiscono il proprio layout a piena larghezza.
const FULLSCREEN_FLOWS = ['/onboarding', '/positions']
// Hero flows: full-width senza padding (il globo del dashboard tocca
// il navbar; il page gestisce il centering dei contenuti sottostanti).
const HERO_FLOWS = ['/dashboard', '/map']

export default function MainChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const hero = HERO_FLOWS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  const fullscreen = FULLSCREEN_FLOWS.some((p) => pathname === p || pathname.startsWith(p + '/'))

  if (hero) return <main className="w-full">{children}</main>
  if (fullscreen) return <main className="w-full px-12 py-8">{children}</main>
  return <main className="max-w-6xl mx-auto px-5 py-8">{children}</main>
}
