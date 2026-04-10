import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { JHT_USER_DIR } from '@/lib/jht-paths'
import Navbar from '@/components/Navbar'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (isSupabaseConfigured) {
    // Modalita' cloud: auth Supabase
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

  // Modalita' locale: path fisso, sempre disponibile
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar user={null} workspace={JHT_USER_DIR} />
      <main className="max-w-6xl mx-auto px-5 py-8">
        {children}
      </main>
    </div>
  )
}
