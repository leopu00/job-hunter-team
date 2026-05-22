'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useDashboardT } from '@/app/components/DashboardI18n'

type Pending = { profile: boolean; team: boolean }
const PENDING_KEY = 'onboarding-popup:pending'
const EVENT_NAME = 'onboarding-popup-update'

export default function NavLinks() {
  const { t } = useDashboardT()
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
      <NavLink href="/dashboard" tour="dashboard">{t('nav_dashboard')}</NavLink>
      <NavLink href="/positions" tour="positions">{t('nav_positions')}</NavLink>
      <NavLink href="/ready" accent="#7fffb2">{t('nav_ready')}</NavLink>
      <NavLink href="/risposte" accent="#58a6ff">{t('nav_risposte')}</NavLink>
      <NavLink href="/crescita">{t('nav_crescita')}</NavLink>
      <NavLink href="/reports">{t('nav_reports')}</NavLink>
      <NavLink href="/team" tour="team" accent="#ffc107" badge={pending.team}>Team</NavLink>
      <NavLink href="/profile" badge={pending.profile}>{t('nav_profile')}</NavLink>
    </div>
  )
}

function NavLink({
  href,
  children,
  accent,
  tour,
  badge,
}: {
  href: string
  children: React.ReactNode
  accent?: string
  tour?: string
  badge?: boolean
}) {
  return (
    <Link
      href={href}
      data-tour={tour}
      className="relative px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
      style={{ color: accent ?? 'var(--color-muted)' } as React.CSSProperties}
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
