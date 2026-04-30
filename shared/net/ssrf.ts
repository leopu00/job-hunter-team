/**
 * SSRF (Server-Side Request Forgery) dispatcher for JHT.
 *
 * ## What this defends against
 *
 * JHT agents (Scout, Analyst, Writer) and a few API routes fetch URLs
 * supplied by external sources — job descriptions, JD detail pages,
 * cloud-sync endpoints. Without validation, an attacker who controls a
 * URL can pivot the JHT process into:
 *
 *   - cloud metadata services (`169.254.169.254`, `metadata.google.internal`)
 *   - LAN devices (`192.168.x.x`, `10.x.x.x`)
 *   - other JHT services on `127.0.0.1` or `::1`
 *   - link-local / multicast / IPv4-mapped-in-IPv6 evasions
 *
 * `safeFetch` is the entry point. It enforces:
 *   1. scheme allowlist (http/https only)
 *   2. literal-IP / hostname blocklist (rejects RFC1918, loopback, link-local,
 *      multicast, broadcast, special-use, deprecated literals)
 *   3. DNS resolution + per-IP blocklist re-check (no public hostname can
 *      pivot to a private resolved address)
 *   4. manual redirect handling: per-hop revalidation, max-redirects cap,
 *      loop detection, cross-origin sensitive-header stripping, body drop
 *      on cross-origin POST → GET coercion (303) and 301/302 POST coercion
 *
 * ## What this does NOT defend against
 *
 * **Dispatcher-level DNS pinning is out of scope.** OpenClaw pins the
 * resolved IPs into an undici `Agent.connect.lookup` so the actual TCP
 * connection bypasses the OS resolver. JHT does not currently take that
 * dependency: a small TOCTOU window remains where, between the DNS
 * validation step and the TCP connect, the OS resolver could re-resolve
 * to a different (private) address. Exploiting this requires attacker
 * control of an authoritative DNS server with very low TTL — a higher
 * bar than basic SSRF. If JHT moves to multi-tenant or cloud-hosted
 * deployment, swap this for an undici-Agent-based dispatcher with
 * `createPinnedDispatcher` (see OpenClaw `infra/net/ssrf.ts`).
 *
 * ## Faithful vs adapted from OpenClaw
 *
 * The IP/hostname classifiers (`shared/net/ip.ts`, `hostname.ts`) are a
 * faithful port. This dispatcher distills the security-relevant slice of
 * OpenClaw's `ssrf.ts` + `fetch-guard.ts` (~1000 lines combined) into a
 * single ~350-line module: dropping proxy-mode dispatchers, undici
 * runtime adapters, capture instrumentation, and pinned dispatchers.
 * The validation primitives are equivalent.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import {
  extractEmbeddedIpv4FromIpv6,
  isBlockedSpecialUseIpv4Address,
  isBlockedSpecialUseIpv6Address,
  isCanonicalDottedDecimalIPv4,
  isIpv4Address,
  isLegacyIpv4Literal,
  parseCanonicalIpAddress,
  parseLooseIpAddress,
  type Ipv4SpecialUseBlockOptions,
} from "./ip.js";
import { normalizeHostname } from "./hostname.js";
import { normalizeLowercaseStringOrEmpty } from "./string-coerce.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrFBlockedError";
  }
}

export type SsrFPolicy = {
  /** Allow private/loopback/link-local addresses. Use only for trusted operator-provided URLs. */
  allowPrivateNetwork?: boolean;
  /** Alias of `allowPrivateNetwork`, kept for OpenClaw call-site compatibility. */
  dangerouslyAllowPrivateNetwork?: boolean;
  /** Allow RFC2544 benchmark range (198.18.0.0/15). Almost never wanted in production. */
  allowRfc2544BenchmarkRange?: boolean;
  /** Hostnames whose literal form skips the private-IP check (still subject to allowlist). */
  allowedHostnames?: string[];
  /** Pattern allowlist (`example.com`, `*.example.com`). Empty = all hostnames pass to next step. */
  hostnameAllowlist?: string[];
};

export type SafeFetchOptions = {
  /** Maximum redirects to follow. Default: 3. */
  maxRedirects?: number;
  /**
   * If `true`, replay request body and unsafe methods across cross-origin redirects.
   * Sensitive headers (Authorization, Cookie) are stripped regardless. Default: `false`.
   */
  allowCrossOriginUnsafeRedirectReplay?: boolean;
  /** Per-request timeout in ms. Combined with caller's `init.signal` if both provided. */
  timeoutMs?: number;
  /** SSRF policy override. Defaults to strict (no private network, all hostnames allowed by allowlist). */
  policy?: SsrFPolicy;
  /** Free-form context string for security audit logs (`safeFetch:<context>`). */
  auditContext?: string;
  /** Test seam: replace the DNS resolver. */
  lookupFn?: typeof dnsLookup;
  /** Test seam: replace the underlying fetch. Defaults to `globalThis.fetch`. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export type SafeFetchResult = {
  response: Response;
  /** Final URL after redirects. */
  finalUrl: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hostname / IP classification
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const DEFAULT_MAX_REDIRECTS = 3;

function resolveIpv4SpecialUseBlockOptions(policy?: SsrFPolicy): Ipv4SpecialUseBlockOptions {
  return { allowRfc2544BenchmarkRange: policy?.allowRfc2544BenchmarkRange === true };
}

function isPrivateNetworkAllowedByPolicy(policy?: SsrFPolicy): boolean {
  return policy?.dangerouslyAllowPrivateNetwork === true || policy?.allowPrivateNetwork === true;
}

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }
  return new Set(values.map((v) => normalizeHostname(v)).filter(Boolean));
}

function normalizeHostnameAllowlist(values?: string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((v) => normalizeHostname(v))
        .filter((v) => v !== "*" && v !== "*." && v.length > 0),
    ),
  );
}

function isHostnameAllowedByPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix || hostname === suffix) {
      return false;
    }
    return hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

function matchesHostnameAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  return allowlist.some((pattern) => isHostnameAllowedByPattern(hostname, pattern));
}

function looksLikeUnsupportedIpv4Literal(address: string): boolean {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) {
    return false;
  }
  if (parts.some((p) => p.length === 0)) {
    return true;
  }
  return parts.every((p) => /^[0-9]+$/.test(p) || /^0x/i.test(p));
}

/**
 * Returns true if the address is a private/internal/special-use IP.
 *
 * Mirrors OpenClaw's `isPrivateIpAddress` (ssrf.ts) — every literal form
 * that could resolve at the OS layer to a non-public address must
 * fail-closed: malformed IPv6, legacy IPv4 (0177.0.0.1, 127.1, 0x7f000001,
 * decimal 2130706433, embedded-IPv4-in-IPv6 sentinels for 6to4/Teredo/NAT64).
 */
export function isPrivateIpAddress(address: string, policy?: SsrFPolicy): boolean {
  const normalized = normalizeHostname(address);
  if (!normalized) {
    return false;
  }
  const blockOptions = resolveIpv4SpecialUseBlockOptions(policy);

  const strictIp = parseCanonicalIpAddress(normalized);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp, blockOptions);
    }
    if (isBlockedSpecialUseIpv6Address(strictIp)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    if (embeddedIpv4) {
      return isBlockedSpecialUseIpv4Address(embeddedIpv4, blockOptions);
    }
    return false;
  }

  if (normalized.includes(":") && !parseLooseIpAddress(normalized)) {
    return true;
  }
  if (!isCanonicalDottedDecimalIPv4(normalized) && isLegacyIpv4Literal(normalized)) {
    return true;
  }
  if (looksLikeUnsupportedIpv4Literal(normalized)) {
    return true;
  }
  return false;
}

function isBlockedHostnameLiteral(normalized: string): boolean {
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isBlockedHostnameOrIp(hostname: string, policy?: SsrFPolicy): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }
  return isBlockedHostnameLiteral(normalized) || isPrivateIpAddress(normalized, policy);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL validation
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Pre-flight URL validation. Throws `SsrFBlockedError` if the URL is
 * malformed, uses a non-http(s) scheme, or has a literal hostname/IP
 * that resolves to a blocked target.
 *
 * This is the static check; `resolveAndAssertPublicHostname` adds DNS
 * resolution + per-IP recheck.
 */
export function validateUrl(rawUrl: string, policy?: SsrFPolicy): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrFBlockedError(`Invalid URL: ${rawUrl}`);
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrFBlockedError(`Blocked scheme: ${parsed.protocol} (only http/https allowed)`);
  }

  const normalized = normalizeHostname(parsed.hostname);
  if (!normalized) {
    throw new SsrFBlockedError("Invalid URL: empty hostname");
  }

  const allowlist = normalizeHostnameAllowlist(policy?.hostnameAllowlist);
  if (!matchesHostnameAllowlist(normalized, allowlist)) {
    throw new SsrFBlockedError(`Blocked hostname (not in allowlist): ${parsed.hostname}`);
  }

  const skipPrivateNetworkChecks =
    isPrivateNetworkAllowedByPolicy(policy) ||
    normalizeHostnameSet(policy?.allowedHostnames).has(normalized);

  if (!skipPrivateNetworkChecks && isBlockedHostnameOrIp(normalized, policy)) {
    throw new SsrFBlockedError(
      `Blocked hostname or private/internal/special-use IP address: ${parsed.hostname}`,
    );
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS resolution + post-resolution validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the hostname via DNS and assert that every returned address
 * passes the IP blocklist. Public hostnames cannot pivot to a private
 * resolved address.
 *
 * Returns the validated address list (caller can use it for logging or
 * future dispatcher-level pinning, but the current `safeFetch` does not
 * pin DNS to specific IPs at the TCP layer — see file header).
 */
export async function resolveAndAssertPublicHostname(
  hostname: string,
  options: { lookupFn?: typeof dnsLookup; policy?: SsrFPolicy } = {},
): Promise<string[]> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new SsrFBlockedError("Invalid hostname");
  }

  const skipPrivateNetworkChecks =
    isPrivateNetworkAllowedByPolicy(options.policy) ||
    normalizeHostnameSet(options.policy?.allowedHostnames).has(normalized);

  // Literal IP: no DNS step, but still re-check (validateUrl was the first
  // pass — call this directly for hostnames that bypass validateUrl).
  const literalIp = parseCanonicalIpAddress(normalized);
  if (literalIp) {
    if (!skipPrivateNetworkChecks && isPrivateIpAddress(normalized, options.policy)) {
      throw new SsrFBlockedError(
        `Blocked: literal IP resolves to private/internal/special-use address: ${hostname}`,
      );
    }
    return [normalized];
  }

  const lookupFn = options.lookupFn ?? dnsLookup;
  const results = await lookupFn(normalized, { all: true });
  if (!results || results.length === 0) {
    throw new SsrFBlockedError(`Unable to resolve hostname: ${hostname}`);
  }

  if (!skipPrivateNetworkChecks) {
    for (const entry of results) {
      if (isBlockedHostnameOrIp(entry.address, options.policy)) {
        throw new SsrFBlockedError(
          `Blocked: ${hostname} resolves to private/internal/special-use IP address (${entry.address})`,
        );
      }
    }
  }

  return results.map((entry) => entry.address);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-origin redirect handling
// ─────────────────────────────────────────────────────────────────────────────

const CROSS_ORIGIN_REDIRECT_SAFE_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-language",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "pragma",
  "range",
  "user-agent",
]);

function retainSafeHeadersForCrossOriginRedirect(
  headers?: HeadersInit,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const incoming = new Headers(headers);
  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of incoming.entries()) {
    if (CROSS_ORIGIN_REDIRECT_SAFE_HEADERS.has(normalizeLowercaseStringOrEmpty(key))) {
      safeHeaders[key] = value;
    }
  }
  return safeHeaders;
}

function dropBodyHeaders(headers?: HeadersInit): HeadersInit | undefined {
  if (!headers) {
    return headers;
  }
  const next = new Headers(headers);
  next.delete("content-encoding");
  next.delete("content-language");
  next.delete("content-length");
  next.delete("content-location");
  next.delete("content-type");
  next.delete("transfer-encoding");
  return next;
}

function rewriteRedirectInitForMethod(
  init: RequestInit | undefined,
  status: number,
): RequestInit | undefined {
  if (!init) {
    return init;
  }
  const currentMethod = init.method?.toUpperCase() ?? "GET";
  const shouldForceGet =
    status === 303
      ? currentMethod !== "GET" && currentMethod !== "HEAD"
      : (status === 301 || status === 302) && currentMethod === "POST";
  if (!shouldForceGet) {
    return init;
  }
  return {
    ...init,
    method: "GET",
    body: undefined,
    headers: dropBodyHeaders(init.headers),
  };
}

function rewriteRedirectInitForCrossOrigin(
  init: RequestInit | undefined,
  allowUnsafeReplay: boolean,
): RequestInit | undefined {
  if (!init || allowUnsafeReplay) {
    return init;
  }
  const currentMethod = init.method?.toUpperCase() ?? "GET";
  if (currentMethod === "GET" || currentMethod === "HEAD") {
    return init;
  }
  return { ...init, body: undefined, headers: dropBodyHeaders(init.headers) };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// ─────────────────────────────────────────────────────────────────────────────
// safeFetch — entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarded fetch. Validates the URL, resolves DNS, re-validates the
 * resolved IPs, then performs the fetch with manual redirect handling.
 * Each redirect hop is independently validated.
 *
 * Throws `SsrFBlockedError` if any validation step fails.
 *
 * @example
 *   const { response, finalUrl } = await safeFetch("https://example.com/jd");
 *   const body = await response.text();
 */
export async function safeFetch(
  rawUrl: string,
  init?: RequestInit,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch is not available in this runtime");
  }

  const maxRedirects =
    typeof options.maxRedirects === "number" && Number.isFinite(options.maxRedirects)
      ? Math.max(0, Math.floor(options.maxRedirects))
      : DEFAULT_MAX_REDIRECTS;

  const timeoutController = new AbortController();
  const timer = options.timeoutMs
    ? setTimeout(() => timeoutController.abort(), options.timeoutMs)
    : undefined;
  const combinedSignal = combineSignals(init?.signal, timeoutController.signal);

  try {
    const visited = new Set<string>([rawUrl]);
    let currentUrl = rawUrl;
    let currentInit: RequestInit | undefined = init ? { ...init } : undefined;
    let redirectCount = 0;
    let parsedUrl = validateUrl(currentUrl, options.policy);

    while (true) {
      await resolveAndAssertPublicHostname(parsedUrl.hostname, {
        lookupFn: options.lookupFn,
        policy: options.policy,
      });

      const requestInit: RequestInit = {
        ...(currentInit ?? {}),
        redirect: "manual",
        ...(combinedSignal ? { signal: combinedSignal } : {}),
      };
      const response = await fetchImpl(parsedUrl.toString(), requestInit);

      if (!isRedirectStatus(response.status)) {
        return { response, finalUrl: parsedUrl.toString() };
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect missing location header (${response.status})`);
      }

      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects})`);
      }

      const nextUrl = new URL(location, parsedUrl);
      const nextUrlStr = nextUrl.toString();
      if (visited.has(nextUrlStr)) {
        throw new Error("Redirect loop detected");
      }
      visited.add(nextUrlStr);

      currentInit = rewriteRedirectInitForMethod(currentInit, response.status);
      if (nextUrl.origin !== parsedUrl.origin) {
        currentInit = rewriteRedirectInitForCrossOrigin(
          currentInit,
          options.allowCrossOriginUnsafeRedirectReplay === true,
        );
        if (currentInit?.headers) {
          currentInit = {
            ...currentInit,
            headers: retainSafeHeadersForCrossOriginRedirect(currentInit.headers),
          };
        }
      }

      void response.body?.cancel();
      currentUrl = nextUrlStr;
      parsedUrl = validateUrl(currentUrl, options.policy);
    }
  } catch (err) {
    if (err instanceof SsrFBlockedError) {
      const ctx = options.auditContext ?? "url-fetch";
      // eslint-disable-next-line no-console
      console.warn(
        `security: blocked URL fetch (safeFetch:${ctx}) reason="${err.message}" target="${rawUrl}"`,
      );
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function combineSignals(
  caller: AbortSignal | null | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (!caller) {
    return timeout;
  }
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([caller, timeout]);
  }
  // Fallback for older runtimes: relay both into a fresh controller.
  const controller = new AbortController();
  const onAbort = (sig: AbortSignal) => () => controller.abort(sig.reason);
  caller.addEventListener("abort", onAbort(caller), { once: true });
  timeout.addEventListener("abort", onAbort(timeout), { once: true });
  if (caller.aborted) {
    controller.abort(caller.reason);
  } else if (timeout.aborted) {
    controller.abort(timeout.reason);
  }
  return controller.signal;
}
