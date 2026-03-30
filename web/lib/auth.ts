import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { NextResponse } from 'next/server'

/**
 * Controlla autenticazione Supabase sulle API route.
 * In modalita' locale (senza Supabase) ritorna null (accesso libero).
 */
export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  }
  return null
}

/** Regex per path sicuri: alfanumerici, slash, underscore, trattino, punto, tilde, spazi, due punti */
const SAFE_PATH_RE = /^[a-zA-Z0-9\/_\-.~ :]+$/

/**
 * Valida che un path non contenga traversal o caratteri pericolosi.
 */
export function isValidPath(p: string): boolean {
  return SAFE_PATH_RE.test(p) && !p.includes('..')
}
