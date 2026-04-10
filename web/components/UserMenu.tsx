'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UserMenuProps {
  avatarUrl?: string
  fullName?: string
  email: string
}

export default function UserMenu({ avatarUrl, fullName, email }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const initials = fullName
    ? fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : email ? email.slice(0, 2).toUpperCase() : '?'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={`Account: ${fullName ?? email}`}
        aria-expanded={open}
        className="w-8 h-8 rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] flex items-center justify-center cursor-pointer hover:border-[var(--color-green)] transition-colors"
      >
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
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[220px] overflow-hidden z-50"
          style={{
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            animation: 'fade-in 0.15s ease both',
          }}
        >
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="text-[12px] font-medium text-[var(--color-bright)] truncate">
              {fullName ?? email.split('@')[0]}
            </div>
            <div className="text-[10px] text-[var(--color-dim)] truncate mt-0.5">
              {email}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2.5 text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-red)] hover:bg-[var(--color-card)] transition-colors cursor-pointer"
          >
            logout
          </button>
        </div>
      )}
    </div>
  )
}
