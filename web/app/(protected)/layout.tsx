import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile, isProfileComplete } from '@/lib/profile-reader'
import { isLocalRequestFromHeaders } from '@/lib/auth'
import Navbar from '@/components/NavbarChrome'
import MainChrome from '@/components/MainChrome'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const hdrs = await headers()
  const localRequest = isLocalRequestFromHeaders(hdrs)
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
        <div className="flex items-stretch">
          <div className="flex-1 min-w-0">
            <MainChrome>{children}</MainChrome>
          </div>
          {/* Mount point per side panel (es. assistente profilo). Se vuoto,
              non occupa spazio (display:contents). Quando il portal monta
              un pannello qui dentro, diventa flex item della riga sopra
              e il main-area si stringe automaticamente via flex-1. */}
          <div id="protected-side-panel" className="contents" />
        </div>
      </div>
    )
  }

  // Local mode OR localhost request with cloud config: no auth.
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar user={null} />
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0">
          <MainChrome>{children}</MainChrome>
        </div>
        <div id="protected-side-panel" className="contents" />
      </div>
    </div>
  )
}
