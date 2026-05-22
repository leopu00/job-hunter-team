'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDashboardT } from '@/app/components/DashboardI18n'

export default function NavLinks() {
  const { t } = useDashboardT()
  const pathname = usePathname() ?? ''

  return (
    <div className="flex items-center gap-1">
      <NavLink href="/dashboard" pathname={pathname} tour="dashboard">{t('nav_dashboard')}</NavLink>
      <NavLink href="/positions" pathname={pathname} tour="positions">{t('nav_positions')}</NavLink>
      <NavLink href="/ready" pathname={pathname} accent="#7fffb2">{t('nav_ready')}</NavLink>
      <NavLink href="/risposte" pathname={pathname} accent="#58a6ff">{t('nav_risposte')}</NavLink>
      <NavLink href="/crescita" pathname={pathname}>{t('nav_crescita')}</NavLink>
      <NavLink href="/reports" pathname={pathname}>{t('nav_reports')}</NavLink>
      <NavLink href="/team" pathname={pathname} tour="team" accent="#ffc107">Team</NavLink>
      <NavLink href="/profile" pathname={pathname}>{t('nav_profile')}</NavLink>
    </div>
  )
}

function NavLink({
  href,
  children,
  accent,
  tour,
  pathname,
}: {
  href: string
  children: React.ReactNode
  accent?: string
  tour?: string
  pathname: string
}) {
  // Active quando il pathname è esattamente la voce o un suo sotto-percorso
  // (es. /team/v2 mantiene "Team" attivo).
  const active = pathname === href || pathname.startsWith(href + '/')
  const color = active ? 'var(--color-white)' : accent ?? 'var(--color-muted)'

  return (
    <Link
      href={href}
      data-tour={tour}
      aria-current={active ? 'page' : undefined}
      className="px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline"
      style={{ color } as React.CSSProperties}
    >
      {children}
    </Link>
  )
}
