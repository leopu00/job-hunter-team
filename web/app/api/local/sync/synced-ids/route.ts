import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Ritorna i `legacy_id` (= position.id da SQLite locale) presenti su
 * Supabase per l'utente loggato. La pagina /positions usa questo set
 * per mostrare un'icona ✓ accanto alle posizioni già sincronizzate.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ legacy_ids: [] })
  }

  const { data, error } = await supabase
    .from('positions')
    .select('legacy_id')
    .eq('user_id', user.id)
    .not('legacy_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const legacy_ids = (data ?? [])
    .map((row) => row.legacy_id)
    .filter((x): x is number => typeof x === 'number')

  return NextResponse.json({ legacy_ids })
}
