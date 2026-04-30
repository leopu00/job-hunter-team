import { normalizeLowercaseStringOrEmpty } from "./string-coerce.js";

/**
 * Lowercase, strip trailing dot, and unwrap IPv6 brackets so that hostnames
 * compare equal regardless of input form.
 *
 * Ported from OpenClaw `src/infra/net/hostname.ts`.
 */
export function normalizeHostname(hostname: string): string {
  const normalized = normalizeLowercaseStringOrEmpty(hostname).replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}
