/**
 * Proxy — Auth Supabase, CORS, rate limiting, request logging
 *
 * Sostituisce middleware.ts (deprecato in Next.js 16).
 * Auth su tutte le rotte, CORS + rate limit solo su /api/*.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { isLocalRequestFromHeaders } from '@/lib/auth'
import { LOCAL_TOKEN_COOKIE, getOrCreateLocalToken } from '@/lib/local-token'

// --- CORS Config ---

const CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']
const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const CORS_HEADERS = 'Content-Type, Authorization, X-Requested-With'

// --- Rate limit (in-memory) ---

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60_000

type RateLimitEntry = { count: number; windowStart: number }
const rateLimitStore = new Map<string, RateLimitEntry>()
let lastCleanup = Date.now()

function getRateLimitKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  return `rl:${ip}`
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()

  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    lastCleanup = now
    for (const [k, entry] of rateLimitStore) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(k)
    }
  }

  const entry = rateLimitStore.get(key)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
  }

  entry.count++
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count)
  const resetAt = entry.windowStart + RATE_LIMIT_WINDOW_MS

  return { allowed: entry.count <= RATE_LIMIT_MAX, remaining, resetAt }
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

// --- Proxy ---

export async function proxy(request: NextRequest) {
  const start = Date.now()
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith('/api/')

  // Espone il pathname ai server component via header: il layout
  // (protected) lo legge per redirigere a /onboarding quando il
  // profilo non è completo. Va propagato a tutte le NextResponse.next()
  // chiamate in questa funzione clonando le request headers.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  // --- API: CORS preflight ---
  if (isApi && request.method === 'OPTIONS') {
    const origin = request.headers.get('origin')
    const res = new NextResponse(null, { status: 204 })
    for (const [k, v] of Object.entries(getCorsHeaders(origin))) res.headers.set(k, v)
    logRequest(request, 204, Date.now() - start)
    return res
  }

  // --- API: Rate limiting ---
  let rlRemaining: number | null = null
  if (isApi) {
    const rlKey = getRateLimitKey(request)
    const { allowed, remaining, resetAt } = checkRateLimit(rlKey)
    rlRemaining = remaining

    if (!allowed) {
      const origin = request.headers.get('origin')
      const res = NextResponse.json(
        { error: 'Troppe richieste. Riprova tra poco.' },
        { status: 429 },
      )
      res.headers.set('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
      res.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX))
      res.headers.set('X-RateLimit-Remaining', '0')
      for (const [k, v] of Object.entries(getCorsHeaders(origin))) res.headers.set(k, v)
      logRequest(request, 429, Date.now() - start)
      return res
    }
  }

  // --- Auth Supabase ---
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  // Local-token bootstrap: sulle richieste che arrivano davvero da
  // localhost (niente forwarded headers, host loopback) settiamo un
  // cookie HttpOnly+SameSite=Strict con il token su disco. Il browser
  // aperto dal desktop launcher lo presentera' alle chiamate API
  // successive; `requireAuth` lo accetta come bypass del flow Supabase.
  // L'attaccante che imposta un x-forwarded-host non passa il check
  // (vedi finding C1) → niente cookie viene settato per loro.
  const localRequest = isLocalRequestFromHeaders(request.headers)
  if (localRequest && !request.cookies.get(LOCAL_TOKEN_COOKIE)) {
    const token = getOrCreateLocalToken()
    if (token) {
      supabaseResponse.cookies.set({
        name: LOCAL_TOKEN_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: false,
        maxAge: 60 * 60 * 24 * 30,
      })
    }
  }

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
      pathname.startsWith('/applications') ||
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
      return NextResponse.redirect(new URL('/?login=true', request.url))
    }

    // Landing page sempre accessibile — nessun redirect da / a /dashboard
  }

  // --- API: Aggiungi CORS + rate limit headers alla risposta ---
  if (isApi) {
    const origin = request.headers.get('origin')
    for (const [k, v] of Object.entries(getCorsHeaders(origin))) supabaseResponse.headers.set(k, v)
    supabaseResponse.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX))
    supabaseResponse.headers.set('X-RateLimit-Remaining', String(rlRemaining ?? RATE_LIMIT_MAX))
    logRequest(request, 200, Date.now() - start)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
