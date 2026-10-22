/**
 * Le politiche CSP del sito (JHT «web capace», W6/P8).
 *
 * Due politiche, una accanto all'altra:
 *   - `buildCsp`: quella IN VIGORE, com'era nel middleware;
 *   - `buildStrictCspReportOnly`: quella più stretta, mandata SOLO come `Content-Security-Policy-Report-Only`.
 *     Non blocca niente: il browser segnala a `/api/csp-report` ciò che bloccherebbe. Si guardano i
 *     rapporti, si corregge ciò che è legittimo, e solo dopo l'operatore decide se farla entrare in vigore.
 *
 * Perché serve: da quando il sito scrive (azioni L1/L2/L3), una XSS vale di più. La politica stretta toglie
 * `'unsafe-inline'` dagli stili (restano gli attributi `style`, che React usa ovunque), limita `connect-src`
 * al sito e al progetto Supabase esatto (non a ogni `*.supabase.co`), vieta di essere incorniciato e
 * chiude `base-uri`.
 *
 * Modulo puro, senza Next: gira nel middleware (edge) e nei test.
 */

const IMG_SRC =
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com";
const FONT_SRC =
  "font-src 'self' data: https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com";
const BASEMAPS =
  "https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com";

/** Dove il browser manda i rapporti di violazione. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** La politica in vigore: invariata rispetto a prima. */
export function buildCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    IMG_SRC,
    FONT_SRC,
    `connect-src 'self' https://*.supabase.co ${BASEMAPS}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * L'origin del progetto Supabase, e il suo socket, da `NEXT_PUBLIC_SUPABASE_URL`. Se non c'è o non si
 * legge, `null`: la politica stretta torna al jolly, mai a "tutto".
 */
export function supabaseConnectSources(
  url: string | undefined,
): string[] | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.host) return null;
    return [`https://${parsed.host}`, `wss://${parsed.host}`];
  } catch {
    return null;
  }
}

/** La politica stretta, da mandare SOLO in Report-Only. Non ha senso in sviluppo (HMR vuole `unsafe-*`). */
export function buildStrictCspReportOnly(
  nonce: string,
  supabaseUrl?: string,
): string {
  const supabase = supabaseConnectSources(supabaseUrl) ?? [
    "https://*.supabase.co",
    "wss://*.supabase.co",
  ];
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Niente 'unsafe-inline' per i fogli di stile; gli attributi style="…" (React) hanno la loro direttiva.
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    IMG_SRC,
    FONT_SRC,
    `connect-src 'self' ${supabase.join(" ")} ${BASEMAPS}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
