/**
 * Local token: auth per il browser caricato dal desktop launcher.
 *
 * Il file `~/.jht/.local-token` contiene 32 byte random in hex (64
 * caratteri). Generato lazy al primo accesso del server. Il
 * middleware setta il valore in un cookie HttpOnly+SameSite=Strict
 * quando rileva una richiesta `localhost` diretta (niente forwarded
 * headers): il browser lo rinvia automaticamente sulle chiamate
 * successive, attraversando `requireAuth`.
 *
 * Header `Authorization: Bearer <token>` resta accettato come
 * fallback per dev manuali (curl). Su deploy cloud (Vercel) la
 * directory home tipicamente non e' scrivibile: la creazione
 * fallisce silenziosamente e il flusso Supabase rimane l'unica via.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { JHT_HOME } from '@/lib/jht-paths'

const TOKEN_FILE = path.join(JHT_HOME, '.local-token')
const TOKEN_BYTES = 32
const TOKEN_HEX_RE = /^[a-f0-9]{64}$/i

/** Nome del cookie usato per propagare il local-token al browser. */
export const LOCAL_TOKEN_COOKIE = 'jht_local_token'

let cached: string | null = null

function readToken(): string | null {
  try {
    const value = fs.readFileSync(TOKEN_FILE, 'utf-8').trim()
    return TOKEN_HEX_RE.test(value) ? value.toLowerCase() : null
  } catch {
    return null
  }
}

function createToken(): string | null {
  try {
    fs.mkdirSync(JHT_HOME, { recursive: true, mode: 0o700 })
    const value = randomBytes(TOKEN_BYTES).toString('hex')
    fs.writeFileSync(TOKEN_FILE, value, { encoding: 'utf-8', mode: 0o600 })
    return value
  } catch {
    return null
  }
}

/** Ritorna il token corrente; lo crea se manca. `null` se il filesystem e' read-only (cloud). */
export function getOrCreateLocalToken(): string | null {
  if (cached) return cached
  cached = readToken() ?? createToken()
  return cached
}

/** Estrae il token bearer da un header `Authorization`. */
export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+([a-f0-9]{64})$/i)
  return match ? match[1].toLowerCase() : null
}

/** Estrae il token dal cookie `jht_local_token`, se presente e ben formato. */
export function extractCookieToken(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null
  return TOKEN_HEX_RE.test(cookieValue) ? cookieValue.toLowerCase() : null
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Verifica se la richiesta presenta un local-token valido, sia via
 * header `Authorization: Bearer <hex>` (curl manuale) sia via cookie
 * `jht_local_token` (browser). Confronto in tempo costante.
 */
export function isLocalTokenAuthenticated(
  headerValue: string | null | undefined,
  cookieValue: string | null | undefined,
): boolean {
  const expected = getOrCreateLocalToken()
  if (!expected) return false
  const fromHeader = extractBearerToken(headerValue)
  if (fromHeader && timingSafeEquals(fromHeader, expected)) return true
  const fromCookie = extractCookieToken(cookieValue)
  if (fromCookie && timingSafeEquals(fromCookie, expected)) return true
  return false
}

/** Path canonico esposto per CLI/Electron consumer. */
export const LOCAL_TOKEN_PATH = TOKEN_FILE
