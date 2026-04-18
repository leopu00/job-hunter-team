import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { JHT_USER_DIR } from '@/lib/jht-paths'
import Navbar from '@/components/Navbar'

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
        <main className="max-w-6xl mx-auto px-5 py-8">
          {children}
        </main>
      </div>
    )
  }

  // Local mode OR localhost request with cloud config: no auth.
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar user={null} workspace={JHT_USER_DIR} />
      <main className="max-w-6xl mx-auto px-5 py-8">
        {children}
      </main>
    </div>
  )
}
