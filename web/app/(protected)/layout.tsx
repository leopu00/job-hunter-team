import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import Navbar from '@/components/Navbar'

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

  // Modalita' locale: verifica workspace
  const workspace = await getWorkspacePath()
  if (!workspace) redirect('/')

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar user={null} workspace={workspace} />
      <main className="max-w-6xl mx-auto px-5 py-8">
        {children}
      </main>
    </div>
  )
}
