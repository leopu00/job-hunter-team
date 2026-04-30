/**
 * SSRF policies and re-exports for the web layer.
 *
 * Centralised so route handlers do not each invent their own private-IP
 * heuristics. The validation primitives live in
 * [`shared/net/ssrf.ts`](../../shared/net/ssrf.ts) — this file just bundles
 * the policies that actually apply to JHT's web routes.
 */

import { safeFetch, type SafeFetchOptions, type SsrFPolicy } from "../../shared/net/ssrf.js";

export { safeFetch, SsrFBlockedError, validateUrl } from "../../shared/net/ssrf.js";
export type { SafeFetchOptions, SsrFPolicy } from "../../shared/net/ssrf.js";

/**
 * Strict policy: block all private/loopback/link-local/special-use targets.
 * Use for any URL that can be supplied or influenced by an end user
 * (webhook URLs, agent-discovered job description URLs, etc.).
 */
export const STRICT_PUBLIC_POLICY: SsrFPolicy = {};

/**
 * Operator-trusted policy: allow private network because the URL is
 * configured via an environment variable that only the operator controls.
 * Used by the gateway proxy and the deploy health-check, both of which
 * point at JHT's own internal services on localhost / LAN.
 *
 * Gated by `JHT_GATEWAY_ALLOW_PRIVATE=1` for the gateway. Other operator
 * URLs use the same flag because the threat model is identical: the
 * machine running JHT is also the machine the operator owns.
 */
export const OPERATOR_TRUSTED_PRIVATE_POLICY: SsrFPolicy = {
  allowPrivateNetwork: true,
};

/**
 * Default fetch options for user-controlled URLs in API routes:
 * strict policy, short timeout, capped redirects, audit-context tag for
 * the security log.
 */
export function userControlledFetchOptions(auditContext: string): SafeFetchOptions {
  return {
    policy: STRICT_PUBLIC_POLICY,
    maxRedirects: 3,
    timeoutMs: 5_000,
    auditContext,
  };
}
