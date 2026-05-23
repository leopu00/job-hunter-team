'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useDashboardT } from '@/app/components/DashboardI18n'

type Pending = { profile: boolean; team: boolean }
const PENDING_KEY = 'onboarding-popup:pending'
const EVENT_NAME = 'onboarding-popup-update'

export default function NavLinks() {
  const { t } = useDashboardT()
  const pathname = usePathname() ?? ''
  const [pending, setPending] = useState<Pending>({ profile: false, team: false })

  useEffect(() => {
    const read = (): Pending => {
      try {
        const raw = sessionStorage.getItem(PENDING_KEY)
        if (!raw) return { profile: false, team: false }
        const v = JSON.parse(raw)
        return { profile: !!v.profile, team: !!v.team }
      } catch {
        return { profile: false, team: false }
      }
    }
    setPending(read())
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<Pending>).detail
      if (detail) setPending(detail)
      else setPending(read())
    }
    window.addEventListener(EVENT_NAME, onUpdate)
    return () => window.removeEventListener(EVENT_NAME, onUpdate)
  }, [])

  return (
    <div className="flex items-center gap-1">
      <NavLink href="/dashboard" pathname={pathname} tour="dashboard">{t('nav_dashboard')}</NavLink>
      <NavLink href="/map" pathname={pathname}>Map</NavLink>
      <NavLink href="/positions" pathname={pathname} tour="positions">{t('nav_positions')}</NavLink>
      <NavLink href="/ready" pathname={pathname}>{t('nav_ready')}</NavLink>
      <NavLink href="/risposte" pathname={pathname}>{t('nav_risposte')}</NavLink>
      <NavLink href="/crescita" pathname={pathname}>{t('nav_crescita')}</NavLink>
      <NavLink href="/reports" pathname={pathname}>{t('nav_reports')}</NavLink>
      <NavLink href="/team" pathname={pathname} tour="team" badge={pending.team}>Team</NavLink>
      <NavLink href="/profile" pathname={pathname} badge={pending.profile}>{t('nav_profile')}</NavLink>
    </div>
  )
}

function NavLink({
  href,
  children,
  accent,
  tour,
  pathname,
  badge,
}: {
  href: string
  children: React.ReactNode
  accent?: string
  tour?: string
  pathname: string
  badge?: boolean
}) {
  // Active quando il pathname è esattamente la voce o un suo sotto-percorso
  // (es. /team/v2 mantiene "Team" attivo). Stato attivo = colore bianco
  // sovrascrivendo l'accent della voce (dev3 commit 06def336).
  const active = pathname === href || pathname.startsWith(href + '/')
  const color = active ? 'var(--color-white)' : accent ?? 'var(--color-muted)'

  return (
    <Link
      href={href}
      data-tour={tour}
      aria-current={active ? 'page' : undefined}
      // `relative` + `inline-block` necessari per posizionare il badge "!"
      // assoluto top-right su Team/Profile quando setup pending
      // (dev2 commit 070f97f8). `uppercase` rimosso intenzionalmente
      // (dev3 polish UI).
      className="relative px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
      style={{ color } as React.CSSProperties}
    >
      {children}
      {badge && (
        <span
          aria-label="setup pending"
          className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full text-[8px] font-bold leading-none"
          style={{
            background: 'var(--color-yellow)',
            color: '#1a1500',
          }}
        >
          !
        </span>
      )}
    </Link>
  )
}
