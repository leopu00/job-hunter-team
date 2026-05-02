import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { headers, cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { LOCAL_TOKEN_COOKIE, isLocalTokenAuthenticated } from '@/lib/local-token'

/**
 * Riconosce come "macchina dell'utente" gli host che il desktop
 * launcher usa per aprire il browser sulla app locale.
 */
export function isLocalhostHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(host.toLowerCase())
}

/**
 * IP loopback (IPv4 / IPv6 / wildcard). Usato per validare forwarded
 * headers che provengono dal proxy interno di Next dev (sempre `::1`).
 */
function isLoopbackIp(ip: string): boolean {
  return /^(::1|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/.test(ip.trim())
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
 * Variante più permissiva di `hasForwardedRequestHeaders`: ammette i
 * forwarded headers SOLO se l'origine remota è loopback (proxy interno
 * di Next dev server, che setta `x-forwarded-for=::1` su connessioni
 * dal Mac). Un attaccante remoto non può fakeare il loopback (l'IP
 * effettivo della connessione TCP non è loopback, e il proxy reverse
 * di un deploy reale lo riscrive con l'IP pubblico).
 *
 * Restituisce `true` (= proxy esterno NON-trusted, blocca) se uno dei
 * forwarded header indica origine non-loopback. `false` (= safe) se
 * mancano forwarded header o se sono tutti loopback.
 */
export function hasUntrustedForwardedHeaders(hdrs: Headers): boolean {
  // RFC 7239 `Forwarded`: difficile da parsare, conservativo: blocca se presente.
  if (hdrs.get('forwarded') !== null) return true

  const xff = hdrs.get('x-forwarded-for')
  if (xff !== null) {
    // Lista "client, proxy1, proxy2"; il client è il primo hop.
    const firstHop = xff.split(',')[0]?.trim() ?? ''
    if (!isLoopbackIp(firstHop)) return true
  }

  const xfh = hdrs.get('x-forwarded-host')
  if (xfh !== null && !isLocalhostHost(xfh)) return true

  const xri = hdrs.get('x-real-ip')
  if (xri !== null && !isLoopbackIp(xri)) return true

  // x-forwarded-proto è informativo (http/https), non identifica l'origine.
  return false
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
  // Header `Host` deve essere localhost. Su deploy pubblico questo è
  // riscritto al dominio reale dal reverse proxy, quindi un attaccante
  // remoto che setta `Host: localhost` viene comunque bloccato qui.
  const host = hdrs.get('host') ?? ''
  if (!isLocalhostHost(host)) return false

  // Forwarded headers ammessi se TUTTI loopback (Next dev server li aggiunge
  // automaticamente sulle request al loopback con valori `::1`/`localhost`).
  // Un proxy esterno avrà valori non-loopback → blocca.
  if (hasUntrustedForwardedHeaders(hdrs)) return false

  return true
}

/** Helper per server components / route handler (App Router async). */
export async function isLocalRequest(): Promise<boolean> {
  return isLocalRequestFromHeaders(await headers())
}

/**
 * Controlla autenticazione sulle API route.
 *
 * Tre vie d'accesso, in ordine:
 *   1. Senza Supabase configurato: pass-through (deploy puramente locale).
 *   2. Local-token valido (cookie HttpOnly settato dal middleware su
 *      richieste localhost dirette, oppure header `Authorization: Bearer`
 *      per chiamate manuali da CLI/curl): pass-through.
 *   3. Sessione Supabase autenticata: pass-through.
 *
 * Negli altri casi 401. La vecchia bypass "l'host e' localhost" non
 * basta: gli header `Host`/`X-Forwarded-Host` sono client-controllabili
 * e venivano sfruttati per l'auth bypass (vedi finding C1).
 */
export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null

  const hdrs = await headers()
  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get(LOCAL_TOKEN_COOKIE)?.value
  if (isLocalTokenAuthenticated(hdrs.get('authorization'), tokenCookie)) return null

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
