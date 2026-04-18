import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Riconosce come "macchina dell'utente" gli host che il desktop
 * launcher usa per aprire il browser sulla app locale.
 */
export function isLocalhostHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(host.toLowerCase())
}

/** Helper per server components / route handler. */
export async function isLocalRequest(): Promise<boolean> {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  return isLocalhostHost(host)
}

/**
 * Controlla autenticazione Supabase sulle API route.
 * In modalita' locale (senza Supabase) ritorna null (accesso libero).
 * Anche le richieste provenienti da localhost/127.0.0.1 bypassano
 * il check: l'app Electron apre il browser sul desktop dell'utente
 * e gli endpoint interni devono rispondere senza login Supabase.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null
  if (await isLocalRequest()) return null

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
