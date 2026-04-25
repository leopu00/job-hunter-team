import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile, isProfileComplete } from '@/lib/profile-reader'
import Navbar from '@/components/NavbarChrome'
import MainChrome from '@/components/MainChrome'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// Hostnames that count as "local desktop" — the web app runs inside
// the user's own container on their machine, so we trust the request
// origin and skip the Supabase auth redirect. Anywhere else (public
// deploy) auth stays enforced.
function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase()
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(h)
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const localRequest = isLocalhostHost(host)
  const pathname = hdrs.get('x-pathname') ?? ''

  // Onboarding gate: finché il profilo locale non è completo l'utente
  // può stare solo su /onboarding. Qualsiasi altra route del gruppo
  // protetto lo rispedisce indietro, così non può saltare il setup
  // cambiando l'URL a mano. Il check gira solo in local mode, dove
  // readWorkspaceProfile() ha senso (in cloud il profilo è su Supabase).
  if (localRequest && pathname && !pathname.startsWith('/onboarding')) {
    if (!isProfileComplete(readWorkspaceProfile())) {
      redirect('/onboarding')
    }
  }

  // Cloud mode (Supabase env configured) AND request from a public
  // host → require auth. Local desktop users bypass even when the
  // web app has Supabase credentials baked in, since /dashboard is
  // opened directly from the JHT Desktop launcher.
  if (isSupabaseConfigured && !localRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/')

    return (
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar user={user} />
        <MainChrome>{children}</MainChrome>
      </div>
    )
  }

  // Local mode OR localhost request with cloud config: no auth.
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar user={null} />
      <MainChrome>{children}</MainChrome>
    </div>
  )
}
