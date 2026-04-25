import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { User } from '@supabase/supabase-js'
import LoginButton from './LoginButton'
import NavLinks from './NavLinks'
import NavbarMobile from './NavbarMobile'
import SettingsMenu from './SettingsMenu'
import UserMenu from './UserMenu'

const LanguageSwitcher = dynamic(() => import('@/app/components/LanguageSwitcher'))

interface NavbarProps {
  user: User | null
}

export default function Navbar({ user }: NavbarProps) {
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const fullName  = user?.user_metadata?.full_name as string | undefined
  const email     = user?.email ?? ''

  return (
    <header
      className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel)]"
    >
      <nav aria-label="Navigazione app" className="px-5 sm:px-6 h-14 flex items-center gap-4">

        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 no-underline group flex-shrink-0"
        >
          <div
            className="w-2 h-2 group-hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-green)', boxShadow: '0 0 8px var(--color-green)' }}
          />
          <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
            JHT
          </span>
        </Link>

        {/* Nav links (desktop) — in flow, centrati con mx-auto cosi` su
            viewport stretto non finiscono mai sopra logo o controlli a
            destra (col vecchio `absolute left-1/2` succedeva). */}
        <div className="hidden md:flex items-center mx-auto">
          <NavLinks />
        </div>

        {/* Mobile hamburger */}
        <NavbarMobile />

        {/* User / Login */}
        {user ? (
          <div className="flex items-center gap-3 flex-shrink-0">
            <LanguageSwitcher direction="down" />
            <SettingsMenu />
            <UserMenu avatarUrl={avatarUrl} fullName={fullName} email={email} />
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-shrink-0">
            <LanguageSwitcher direction="down" />
            <SettingsMenu />
            <LoginButton />
          </div>
        )}
      </nav>
    </header>
  )
}

