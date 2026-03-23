'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-red)] transition-colors px-3 py-1.5 border border-[var(--color-border)] rounded hover:border-[var(--color-red)] cursor-pointer"
    >
      logout
    </button>
  )
}
