/**
 * SSRF policies and re-exports for the web layer.
 *
 * STATO (verificato 25/07/2026): nessun consumatore attivo. Il modulo
 * nasce il 30/04 per la route webhook `test-ping`, che oggi non esiste
 * più; da allora nessuna route fa fetch verso URL forniti dall'utente
 * (`reverse-geocode` → Nominatim, `device-register` → Supabase,
 * `ai-assistant` → OpenAI: host tutti costanti), quindi NON c'è una
 * superficie SSRF scoperta. Il modulo resta in repo deliberatamente:
 * non essendo importato non entra nel bundle (costo zero a runtime) ed
 * è la guardia pronta all'uso per il primo fetch verso un URL di
 * provenienza esterna — webhook, callback, import da link, scraping.
 * Se ne aggiungi uno, passa da `safeFetch` invece di reinventare le
 * euristiche sugli IP privati.
 *
 * Centralised so route handlers do not each invent their own private-IP
 * heuristics. The validation primitives live in
 * [`./net/ssrf.ts`](./net/ssrf.ts) — this file just bundles the policies
 * that actually apply to JHT's web routes.
 *
 * NB: i primitives vivono dentro `web/lib/net/` invece che in `shared/net/`
 * perché Turbopack (Next 16) non risolve correttamente cross-package import
 * + npm packages (ipaddr.js) consumati da file fuori dal project root.
 * Vedi BUG-TURBOPACK-SHARED-RESOLVE in BACKLOG.md per la storia completa.
 * La copia gemella `shared/net/` è stata rimossa il 2026-07-25: era rimasta
 * come "riferimento OpenClaw" per ipotetici consumer non-web che non sono mai
 * arrivati, e una seconda implementazione di una difesa SSRF è un rischio, non
 * un archivio. L'originale da cui confrontarsi è OpenClaw, non un file qui.
 */

import { safeFetch, type SafeFetchOptions, type SsrFPolicy } from "./net/ssrf";

export { safeFetch, SsrFBlockedError, validateUrl } from "./net/ssrf";
export type { SafeFetchOptions, SsrFPolicy } from "./net/ssrf";

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
export function userControlledFetchOptions(
  auditContext: string,
): SafeFetchOptions {
  return {
    policy: STRICT_PUBLIC_POLICY,
    maxRedirects: 3,
    timeoutMs: 5_000,
    auditContext,
  };
}
