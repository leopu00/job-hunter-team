/**
 * Middleware — Auth Supabase, CORS, rate limiting, CSP nonce, request logging
 *
 * Filename `middleware.ts` (non `proxy.ts`): in Next.js 16 il rename
 * `proxy.ts` forza il bundling di questa pipeline come Node Lambda
 * (`@vercel/next` → onServer), e quel code path su Vercel ha un bug
 * che esclude `@swc/helpers/esm/*.js` dal bundle → 500
 * `MIDDLEWARE_INVOCATION_FAILED` su ogni request (issue #86099,
 * riscontrato 2026-05-14 dopo merge feat dashboard 3-way). Il vecchio
 * nome `middleware.ts` resta supportato in 16.2.x e di default usa
 * Edge runtime, che ha una pipeline di bundling stabile.
 *
 * Vincolo Edge: niente `node:fs`/`node:crypto`/Database. Il
 * bootstrap del local-token (che leggeva `~/.jht/.local-token`)
 * resta solo lato API (route handler) tramite `lib/local-token.ts`;
 * il desktop launcher pre-setta il cookie via `/api/local-bootstrap`
 * o passa `Authorization: Bearer <hex>` sulle chiamate API.
 *
 * Auth su tutte le rotte, CORS + rate limit solo su /api/*,
 * CSP nonce-based su tutte le risposte HTML.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { shouldRejectBrowserMutation } from '@/lib/csrf'

// --- Local request detection (inlined da lib/auth.ts per Edge compat) ---
// lib/auth.ts importa `next/headers` + `lib/workspace` (`node:fs`) →
// non importabile in Edge runtime. Replicato qui solo il puro
// header-parsing che serve al middleware.

const LOCAL_TOKEN_COOKIE = 'jht_local_token'

function isLocalhostHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(host.toLowerCase())
}

function isLoopbackIp(ip: string): boolean {
  return /^(::1|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/.test(ip.trim())
}

function hasUntrustedForwardedHeaders(hdrs: Headers): boolean {
  if (hdrs.get('forwarded') !== null) return true
  const xff = hdrs.get('x-forwarded-for')
  if (xff !== null) {
    const firstHop = xff.split(',')[0]?.trim() ?? ''
    if (!isLoopbackIp(firstHop)) return true
  }
  const xfh = hdrs.get('x-forwarded-host')
  if (xfh !== null && !isLocalhostHost(xfh)) return true
  const xri = hdrs.get('x-real-ip')
  if (xri !== null && !isLoopbackIp(xri)) return true
  return false
}

function isLocalRequestFromHeaders(hdrs: Headers): boolean {
  const host = hdrs.get('host') ?? ''
  if (!isLocalhostHost(host)) return false
  if (hasUntrustedForwardedHeaders(hdrs)) return false
  return true
}

// --- CSP nonce ---
// Production: script-src 'self' 'nonce-XXX' 'strict-dynamic' (no unsafe-inline).
// Development: 'unsafe-inline' + 'unsafe-eval' for HMR/Fast Refresh.
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function buildCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
    "font-src 'self' data: https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
    "connect-src 'self' https://*.supabase.co https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

// --- CORS Config ---

const CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']
const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const CORS_HEADERS = 'Content-Type, Authorization, X-Requested-With'

// --- Rate limit (in-memory) ---
//
// Tier: utente locale (browser sul Mac dell'utente) vs richiesta remota
// (deploy esposto in rete). Una dashboard real-time come /team
// legittimamente fa ~140 req/min per polling concorrente di chart +
// status + animazioni; il limit globale 120 era anti-abuse di un
// servizio esposto, troppo stretto per uso locale. Manteniamo il limit
// stretto per remote (anti-DDoS/scraping su deploy pubblico) e ne
// usiamo uno più permissivo per le request che arrivano direttamente
// al socket localhost (vedi `isLocalRequestFromHeaders`).

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_LOCAL_MAX = 600   // ~10 req/sec per utente sul proprio Mac
const RATE_LIMIT_PUBLIC_MAX = 120  // anti-abuse per anonymous (anti-DDoS basic)
const RATE_LIMIT_AUTH_MAX = 600    // 2026-05-23: authenticated users hanno quota
                                   // separata e generosa (10 req/sec). Motivazione:
                                   // /team con multi-tab apertura sommava sul rate
                                   // limit per IP, bloccando le PATCH del refactor
                                   // team_state. Ora il bucket è per session id
                                   // (cookie supabase) → tab dello stesso utente
                                   // condividono ma anon abusers restano cappati.
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60_000

type RateLimitEntry = { count: number; windowStart: number }
const rateLimitStore = new Map<string, RateLimitEntry>()
let lastCleanup = Date.now()

function getRateLimitKey(req: NextRequest): { key: string; authed: boolean } {
  // Prefer session-based key: leggiamo il cookie session Supabase (sb-*-auth-token).
  // Se presente, scopriamo l'utente e usiamo `user:<jti-prefix>` come chiave.
  // Fallback a IP per anon. Cosi tab multiple dello stesso utente condividono
  // la quota (alta), mentre IP separati restano isolati.
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.endsWith('-auth-token') && c.value) {
      // Hash leggero del cookie value per chiave stabile + privacy
      let h = 0
      for (let i = 0; i < c.value.length && i < 256; i++) h = ((h << 5) - h + c.value.charCodeAt(i)) | 0
      return { key: `rl:user:${h.toString(36)}`, authed: true }
    }
  }
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  return { key: `rl:ip:${ip}`, authed: false }
}

function checkRateLimit(keyInfo: { key: string; authed: boolean }, isLocal: boolean): { allowed: boolean; remaining: number; resetAt: number; max: number } {
  const now = Date.now()
  const key = keyInfo.key
  const max = isLocal
    ? RATE_LIMIT_LOCAL_MAX
    : keyInfo.authed
      ? RATE_LIMIT_AUTH_MAX
      : RATE_LIMIT_PUBLIC_MAX

  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    lastCleanup = now
    for (const [k, entry] of rateLimitStore) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(k)
    }
  }

  const entry = rateLimitStore.get(key)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: max - 1, resetAt: now + RATE_LIMIT_WINDOW_MS, max }
  }

  entry.count++
  const remaining = Math.max(0, max - entry.count)
  const resetAt = entry.windowStart + RATE_LIMIT_WINDOW_MS

  return { allowed: entry.count <= max, remaining, resetAt, max }
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '86400',
  }

  if (origin && CORS_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  } else {
    headers['Access-Control-Allow-Origin'] = CORS_ORIGINS[0]
  }

  return headers
}

function logRequest(req: NextRequest, status: number, durationMs: number): void {
  const method = req.method
  const path = req.nextUrl.pathname
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] ${method} ${path} ${status} ${durationMs}ms`)
}

// --- Middleware ---

export async function middleware(request: NextRequest) {
  const start = Date.now()
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith('/api/')

  // Espone il pathname ai server component via header: il layout
  // (protected) lo legge per redirigere a /onboarding quando il
  // profilo non è completo. Va propagato a tutte le NextResponse.next()
  // chiamate in questa funzione clonando le request headers.
  // `x-search` espone anche la query string: il layout la usa per
  // costruire un `returnTo` completo quando l'utente non e' loggato,
  // cosi' che deep-link come /cli-link?code=ABCD-1234 sopravvivano al
  // roundtrip di login.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  requestHeaders.set('x-search', request.nextUrl.search)

  // CSP nonce: generated per request, exposed to RSCs via x-nonce header
  // and applied to the final response's Content-Security-Policy.
  const isDevelopment = process.env.NODE_ENV === 'development'
  const nonce = generateNonce()
  requestHeaders.set('x-nonce', nonce)

  // --- API: CORS preflight ---
  if (isApi && request.method === 'OPTIONS') {
    const origin = request.headers.get('origin')
    const res = new NextResponse(null, { status: 204 })
    for (const [k, v] of Object.entries(getCorsHeaders(origin))) res.headers.set(k, v)
    logRequest(request, 204, Date.now() - start)
    return res
  }

  // --- API: CSRF guard sui metodi mutanti ---
  // Browser cross-origin POST/PUT/PATCH/DELETE → 403. Pattern OpenClaw
  // browserMutationGuardMiddleware. CLI/curl (no Origin/Referer)
  // continuano a funzionare; SOP + Origin in allowlist coprono i browser.
  //
  // `hostOrigin` viene dedotto dai forwarded headers per accettare
  // automaticamente same-origin POST sul dominio prod (es. jobhunterteam.ai)
  // senza dover settare JHT_PUBLIC_ORIGIN — il browser presenta Origin
  // == server host, quindi non è CSRF per definizione.
  if (isApi) {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const rawHost = request.headers.get('host')?.trim()
    const proto = forwardedProto || request.nextUrl.protocol.replace(':', '')
    const host = forwardedHost || rawHost
    const hostOrigin = host ? `${proto}://${host}` : null

    const reject = shouldRejectBrowserMutation({
      method: request.method,
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      hostOrigin,
    })
    if (reject) {
      const res = NextResponse.json(
        { error: 'Cross-origin mutation rejected' },
        { status: 403 },
      )
      logRequest(request, 403, Date.now() - start)
      return res
    }
  }

  // --- API: Rate limiting ---
  let rlRemaining: number | null = null
  let rlMax: number = RATE_LIMIT_PUBLIC_MAX
  if (isApi) {
    const isLocal = isLocalRequestFromHeaders(request.headers)
    const rlKey = getRateLimitKey(request)
    const { allowed, remaining, resetAt, max } = checkRateLimit(rlKey, isLocal)
    rlRemaining = remaining
    rlMax = max

    if (!allowed) {
      const origin = request.headers.get('origin')
      const res = NextResponse.json(
        { error: 'Troppe richieste. Riprova tra poco.' },
        { status: 429 },
      )
      res.headers.set('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
      res.headers.set('X-RateLimit-Limit', String(max))
      res.headers.set('X-RateLimit-Remaining', '0')
      for (const [k, v] of Object.entries(getCorsHeaders(origin))) res.headers.set(k, v)
      logRequest(request, 429, Date.now() - start)
      return res
    }
  }

  // --- Auth Supabase ---
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const localRequest = isLocalRequestFromHeaders(request.headers)
  const supabaseConfig = getSupabaseConfig()

  if (supabaseConfig.configured) {
    const supabase = createServerClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Rotte protette — redirect al login se non autenticato
    const isProtected =
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/profile') ||
      pathname.startsWith('/positions') ||
      pathname.startsWith('/ready') ||
      pathname.startsWith('/risposte') ||
      pathname.startsWith('/crescita') ||
      pathname.startsWith('/team') ||
      pathname.startsWith('/scout') ||
      pathname.startsWith('/analista') ||
      pathname.startsWith('/scorer') ||
      pathname.startsWith('/scrittore') ||
      pathname.startsWith('/critico')

    // Bypass auth per richieste locali (desktop container): il login
    // Supabase è opzionale in locale, "Continua senza" in /onboarding/cloud
    // deve poter accedere a /dashboard senza account.
    if (isProtected && !user && !localRequest) {
      const returnTo = pathname + request.nextUrl.search
      const loginUrl = new URL('/?login=true', request.url)
      if (returnTo && returnTo !== '/') {
        loginUrl.searchParams.set('returnTo', returnTo)
      }
      return NextResponse.redirect(loginUrl)
    }

    // Landing page sempre accessibile — nessun redirect da / a /dashboard
  }

  // Local-token bootstrap: rimosso dal middleware perchè la lettura
  // `~/.jht/.local-token` richiede `node:fs`, incompatibile con
  // Edge runtime. Il cookie `jht_local_token` viene ora settato:
  //   - dal desktop launcher al primo apertura del browser (Electron
  //     session.cookies.set), oppure
  //   - lazy dalla route `/api/local-bootstrap` (TODO) invocata dal
  //     client al boot.
  // Le richieste con `Authorization: Bearer <hex>` (curl / CLI)
  // continuano a funzionare via `requireAuth` nelle route handler.
  void LOCAL_TOKEN_COOKIE // riferimento per documentazione futura

  // --- API: Aggiungi CORS + rate limit headers alla risposta ---
  if (isApi) {
    const origin = request.headers.get('origin')
    for (const [k, v] of Object.entries(getCorsHeaders(origin))) supabaseResponse.headers.set(k, v)
    supabaseResponse.headers.set('X-RateLimit-Limit', String(rlMax))
    supabaseResponse.headers.set('X-RateLimit-Remaining', String(rlRemaining ?? rlMax))
    logRequest(request, 200, Date.now() - start)
  } else {
    // CSP applies to HTML responses (everything that isn't /api/*).
    supabaseResponse.headers.set('Content-Security-Policy', buildCsp(nonce, isDevelopment))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
