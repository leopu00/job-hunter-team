'use client'

import Link from 'next/link'
import { useDashboardT } from '@/app/components/DashboardI18n'
import TeamDropdown from './TeamDropdown'

export default function NavLinks() {
  const { t } = useDashboardT()

  return (
    <div className="hidden md:flex items-center gap-1 flex-1 justify-start ml-8">
      <NavLink href="/dashboard">{t('nav_dashboard')}</NavLink>
      <NavLink href="/positions">{t('nav_positions')}</NavLink>
      <NavLink href="/applications">{t('nav_applications')}</NavLink>
      <NavLink href="/ready" accent="#7fffb2">{t('nav_ready')}</NavLink>
      <NavLink href="/risposte" accent="#58a6ff">{t('nav_risposte')}</NavLink>
      <NavLink href="/crescita">{t('nav_crescita')}</NavLink>
      <NavLink href="/reports">{t('nav_reports')}</NavLink>
      <TeamDropdown />
      <NavLink href="/profile">{t('nav_profile')}</NavLink>
    </div>
  )
}

function NavLink({ href, children, accent }: { href: string; children: React.ReactNode; accent?: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase hover:bg-[var(--color-card)] rounded transition-colors no-underline"
      style={{ color: accent ?? 'var(--color-muted)' } as React.CSSProperties}
    >
      {children}
    </Link>
  )
}
