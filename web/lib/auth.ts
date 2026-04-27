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

/**
 * Header che indicano la presenza di un reverse-proxy. Quando uno di
 * questi header e' presente la richiesta NON puo' essere considerata
 * "direct localhost": x-forwarded-host e' client-controllable e
 * permetterebbe il bypass dell'auth su deployment esposti in rete.
 * Pattern: OpenClaw `hasForwardedRequestHeaders` (gateway/auth.ts).
 */
const FORWARDED_REQUEST_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
] as const

export function hasForwardedRequestHeaders(hdrs: Headers): boolean {
  return FORWARDED_REQUEST_HEADERS.some((name) => hdrs.get(name) !== null)
}

/**
 * Helper sincrono che valuta una richiesta gia' parsata.
 *
 * Bypassa il check Supabase SOLO se la richiesta arriva direttamente
 * al socket dell'app (niente forwarded headers) E l'header `Host`
 * matcha localhost. Nessuna fiducia in `x-forwarded-host`.
 *
 * Usare questa variante in middleware (`proxy.ts`) e ovunque le
 * `Headers` siano gia' disponibili senza dover chiamare `headers()`.
 */
export function isLocalRequestFromHeaders(hdrs: Headers): boolean {
  if (hasForwardedRequestHeaders(hdrs)) return false
  const host = hdrs.get('host') ?? ''
  return isLocalhostHost(host)
}

/** Helper per server components / route handler (App Router async). */
export async function isLocalRequest(): Promise<boolean> {
  return isLocalRequestFromHeaders(await headers())
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
