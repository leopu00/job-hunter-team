'use client'

import Link from 'next/link'
import { useDashboardT } from '@/app/components/DashboardI18n'
import TeamDropdown from './TeamDropdown'

export default function NavLinks() {
  const { t } = useDashboardT()

  return (
    <div className="flex items-center gap-1">
      <NavLink href="/dashboard" tour="dashboard">{t('nav_dashboard')}</NavLink>
      <NavLink href="/positions" tour="positions">{t('nav_positions')}</NavLink>
      <NavLink href="/applications" tour="applications">{t('nav_applications')}</NavLink>
      <NavLink href="/ready" accent="#7fffb2">{t('nav_ready')}</NavLink>
      <NavLink href="/risposte" accent="#58a6ff">{t('nav_risposte')}</NavLink>
      <NavLink href="/crescita">{t('nav_crescita')}</NavLink>
      <NavLink href="/reports">{t('nav_reports')}</NavLink>
      <span data-tour="team" style={{ display: 'inline-flex' }}><TeamDropdown /></span>
      <NavLink href="/profile">{t('nav_profile')}</NavLink>
    </div>
  )
}

function NavLink({ href, children, accent, tour }: { href: string; children: React.ReactNode; accent?: string; tour?: string }) {
  return (
    <Link
      href={href}
      data-tour={tour}
      className="px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase hover:bg-[var(--color-card)] rounded transition-colors no-underline"
      style={{ color: accent ?? 'var(--color-muted)' } as React.CSSProperties}
    >
      {children}
    </Link>
  )
}
