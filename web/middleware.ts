/**
 * Per-request middleware that emits a nonce-based Content Security Policy.
 *
 * Why a middleware (and not just `headers()` in next.config.ts):
 *   - The nonce changes per request. A static CSP can't carry it.
 *   - Next.js, when it sees the `x-nonce` request header, automatically
 *     applies the nonce to the inline scripts it emits during streaming
 *     (Flight payload, hydration data). That gives us nonce-based defence
 *     against script-injection XSS without manually nonce-ing every
 *     framework-generated tag.
 *
 * Threat closed by this CSP:
 *   - Reflected/stored XSS that injects a `<script>` tag (or `eval`,
 *     `<script src>`, inline-event handler) into the dashboard HTML.
 *     Without a matching nonce the browser refuses to execute it.
 *
 * Strategy:
 *   - Production: `script-src 'self' 'nonce-XXX' 'strict-dynamic'`. No
 *     `'unsafe-inline'`. With `'strict-dynamic'`, the browser also
 *     ignores host whitelists for scripts and only trusts the nonce
 *     plus things those scripts load themselves — the OWASP recommended
 *     deployment.
 *   - Development: keep `'unsafe-inline'` and `'unsafe-eval'`. Next's
 *     HMR / Fast Refresh injects evaluator scripts that nonce-only would
 *     break; CSP is not the layer to harden the dev server with.
 *   - Styles: `style-src 'self' 'unsafe-inline'`. Inline `style` JSX
 *     attributes pervade the codebase; tightening style-src is a
 *     separate, lower-impact hardening step (script XSS dominates).
 */

import { NextRequest, NextResponse } from 'next/server'

function generateNonce(): string {
  // 16 random bytes → 24 base64 chars. Plenty for CSP-nonce uniqueness.
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
    "img-src 'self' data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function middleware(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV === 'development'
  const nonce = generateNonce()

  // Propagate the nonce to RSCs / route handlers so they can attach it
  // to their own inline `<script>` tags via `headers().get('x-nonce')`.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', buildCsp(nonce, isDevelopment))
  return response
}

export const config = {
  // Skip API routes (no HTML, CSP doesn't apply), Next static assets,
  // image optimisation, and OG/sitemap endpoints. The `missing` clause
  // also avoids regenerating the nonce for prefetch requests, which
  // would invalidate the cached HTML's matching nonce.
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|install.sh).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
