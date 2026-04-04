/**
 * Edge Middleware — CORS, rate limiting basico, request logging
 *
 * Attivo solo su /api/* routes. Rate limit IP-based con sliding window.
 */
import { NextRequest, NextResponse } from 'next/server'

// --- Config ---

const CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']
const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const CORS_HEADERS = 'Content-Type, Authorization, X-Requested-With'

const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minuto
const RATE_LIMIT_MAX = 120          // max richieste per finestra
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60_000 // pulizia ogni 5 min

// --- Rate limit store (in-memory, edge-compatible) ---

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

  // Pulizia periodica entry scadute
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

// --- CORS ---

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

// --- Logging ---

function logRequest(req: NextRequest, status: number, durationMs: number): void {
  const method = req.method
  const path = req.nextUrl.pathname
  const ts = new Date().toISOString().slice(11, 23)
  // Edge runtime: console.log va a Vercel/stdout
  console.log(`[${ts}] ${method} ${path} ${status} ${durationMs}ms`)
}

// --- Middleware ---

export function middleware(req: NextRequest) {
  const start = Date.now()
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  // Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v)
    logRequest(req, 204, Date.now() - start)
    return res
  }

  // Rate limiting
  const rlKey = getRateLimitKey(req)
  const { allowed, remaining, resetAt } = checkRateLimit(rlKey)

  if (!allowed) {
    const res = NextResponse.json(
      { error: 'Troppe richieste. Riprova tra poco.' },
      { status: 429 },
    )
    res.headers.set('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
    res.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX))
    res.headers.set('X-RateLimit-Remaining', '0')
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v)
    logRequest(req, 429, Date.now() - start)
    return res
  }

  // Continua al route handler
  const res = NextResponse.next()

  // CORS headers
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v)

  // Rate limit headers
  res.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX))
  res.headers.set('X-RateLimit-Remaining', String(remaining))

  logRequest(req, 200, Date.now() - start)
  return res
}

// Attivo solo su API routes
export const config = {
  matcher: '/api/:path*',
}
