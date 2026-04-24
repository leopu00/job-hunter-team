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
  workspace?: string | null
}

export default function Navbar({ user, workspace }: NavbarProps) {
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const fullName  = user?.user_metadata?.full_name as string | undefined
  const email     = user?.email ?? ''

  return (
    <header
      style={{ position: 'relative', zIndex: 10 }}
      className="border-b border-[var(--color-border)] bg-[var(--color-panel)]"
    >
      <nav aria-label="Navigazione app" className="relative px-5 sm:px-6 h-14 flex items-center gap-4">

        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 no-underline group"
        >
          <div
            className="w-2 h-2 group-hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-green)', boxShadow: '0 0 8px var(--color-green)' }}
          />
          <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
            JHT
          </span>
        </Link>

        {/* Nav links (desktop) — absolute centered */}
        <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 hidden md:flex items-center">
          <NavLinks />
        </div>

        {/* Mobile hamburger */}
        <NavbarMobile />

        {/* User / Login */}
        {user ? (
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher direction="down" />
            <SettingsMenu />
            <UserMenu avatarUrl={avatarUrl} fullName={fullName} email={email} />
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher direction="down" />
            {workspace && <WorkspacePath path={workspace} />}
            <SettingsMenu />
            <LoginButton />
          </div>
        )}
      </nav>
    </header>
  )
}

function WorkspacePath({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean)
  // Rimuovi i segmenti "Users" e username per un path piu' pulito
  const homeIdx = segments.indexOf('Users')
  const display = homeIdx !== -1 && homeIdx + 2 < segments.length
    ? segments.slice(homeIdx + 2)
    : segments.slice(-3)

  return (
    <Link
      href="/?change=true"
      className="hidden sm:flex items-center gap-1.5 max-w-[320px] no-underline hover:opacity-75 transition-opacity cursor-pointer"
    >
      <span className="text-[11px] flex-shrink-0" role="img" aria-label="cartella">📁</span>
      {display.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">›</span>}
          <span
            className="text-[10px] font-medium truncate"
            title={seg}
            style={{
              color: i === display.length - 1 ? 'var(--color-bright)' : 'var(--color-dim)',
              maxWidth: i === display.length - 1 ? '140px' : '80px',
            }}
          >
            {seg}
          </span>
        </span>
      ))}
    </Link>
  )
}
