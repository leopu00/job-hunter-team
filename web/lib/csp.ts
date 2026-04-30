/**
 * Server-side helper to read the per-request CSP nonce.
 *
 * Use in Server Components that render inline `<script>` tags, so the
 * tags carry the nonce and survive the middleware-set CSP. See
 * `web/middleware.ts` for the policy source of truth.
 *
 * Returns `undefined` for routes the middleware doesn't cover (API,
 * static assets) so callers can still use this without crashing during
 * SSR of those branches.
 */

import { headers } from 'next/headers'

export async function getNonce(): Promise<string | undefined> {
  const h = await headers()
  return h.get('x-nonce') ?? undefined
}
