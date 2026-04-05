import Link from 'next/link'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'
import LogoutButton from './LogoutButton'
import LoginButton from './LoginButton'
import TeamDropdown from './TeamDropdown'
import { NotificationCenter } from '@/app/components/NotificationCenter'
import NavbarMobile from './NavbarMobile'

interface NavbarProps {
  user: User | null
  workspace?: string | null
}

export default function Navbar({ user, workspace }: NavbarProps) {
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const fullName  = user?.user_metadata?.full_name as string | undefined
  const email     = user?.email ?? ''
  const initials  = fullName
    ? fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : email ? email.slice(0, 2).toUpperCase() : '?'

  return (
    <header
      style={{ position: 'relative', zIndex: 10 }}
      className="border-b border-[var(--color-border)] bg-[var(--color-panel)]"
    >
      <nav className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">

        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 no-underline group"
        >
          <span className="text-[var(--color-green)] font-bold text-sm tracking-tight group-hover:opacity-80 transition-opacity">
            JHT
          </span>
          <span className="text-[var(--color-dim)] text-[10px] tracking-widest uppercase hidden sm:block">
            / dashboard
          </span>
        </Link>

        {/* Nav links (desktop) */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-start ml-8">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/positions">Posizioni</NavLink>
          <NavLink href="/applications">Candidature</NavLink>
          <NavLink href="/ready" accent="#7fffb2">Pronte</NavLink>
          <NavLink href="/risposte" accent="#58a6ff">Risposte</NavLink>
          <NavLink href="/crescita">Crescita</NavLink>
          <NavLink href="/reports">Report</NavLink>
          <TeamDropdown />
          <NavLink href="/profile">Profilo</NavLink>
        </div>

        {/* Mobile hamburger */}
        <NavbarMobile />

        {/* Notifications + User / Login */}
        {user ? (
          <div className="flex items-center gap-3">
            <NotificationCenter />
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[11px] text-[var(--color-bright)] leading-none font-medium">
                {fullName ?? email.split('@')[0]}
              </span>
              <span className="text-[10px] text-[var(--color-dim)] leading-none mt-0.5">
                {email}
              </span>
            </div>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full overflow-hidden border border-[var(--color-border)] flex-shrink-0 bg-[var(--color-card)] flex items-center justify-center">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={fullName ?? 'avatar'}
                  width={32}
                  height={32}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[11px] font-bold text-[var(--color-green)]">
                  {initials}
                </span>
              )}
            </div>

            <LogoutButton />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <NotificationCenter />
            {workspace && <WorkspacePath path={workspace} />}
            <LoginButton />
          </div>
        )}
      </nav>
    </header>
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
