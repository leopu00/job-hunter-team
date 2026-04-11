import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import CloudSyncClient from './CloudSyncClient'

export const dynamic = 'force-dynamic'

interface SyncTokenRow {
  id: string
  name: string
  token_prefix: string
  last_used_at: string | null
  created_at: string
}

export default async function CloudSyncPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen p-12 text-center">
        <h1 className="text-xl font-medium text-[var(--color-white)] mb-2">
          Cloud Sync
        </h1>
        <p className="text-[var(--color-dim)] text-[11px]">
          Disponibile solo in modalità cloud (jobhunterteam.ai).
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return (
      <div className="p-12 text-center text-[var(--color-muted)]">
        Session expired.{' '}
        <Link href="/" className="text-[var(--color-green)]">
          Sign in again
        </Link>
      </div>
    )
  }

  const { data: tokens } = await supabase
    .from('cloud_sync_tokens')
    .select('id, name, token_prefix, last_used_at, created_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  return <CloudSyncClient initialTokens={(tokens ?? []) as SyncTokenRow[]} />
}
