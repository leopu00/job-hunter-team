// Scadenza del token cloud-sync di QUESTO box, per `jht cloud status`.
//
// Un token web con scadenza, una volta scaduto, scollega il box in silenzio:
// il cloud risponde 401 e il daemon smette di sincronizzare. Il box non
// conserva la scadenza (cloud.json ha solo il token), quindi la chiede al
// server: /api/cloud-sync/ping restituisce `token.expires_at` a chi presenta
// quel token. Nessun segreto nuovo, niente scritto su disco.

import { cloudSyncHeaders } from './client-identity.js';

/** Stessa soglia dell'avviso nella lista token del web. */
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;
const PING_TIMEOUT_MS = 5_000;

/**
 * @returns {Promise<
 *   | { kind: 'reported', expiresAt: string | null }
 *   | { kind: 'expired' }
 *   | { kind: 'unknown', reason: string }
 * >}
 */
export async function probeTokenExpiry(config, { fetchImpl = fetch } = {}) {
  if (!config?.base_url || !config?.token) {
    return { kind: 'unknown', reason: 'no token in the local configuration' };
  }
  const baseUrl = String(config.base_url).replace(/\/+$/, '');
  let res;
  let body;
  try {
    res = await fetchImpl(`${baseUrl}/api/cloud-sync/ping`, {
      headers: cloudSyncHeaders(config.token),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    return { kind: 'unknown', reason: 'cloud unreachable' };
  }
  // verifyBearerToken: 401 {"error":"token scaduto"} quando expires_at e' passato.
  if (res.status === 401 && body?.error === 'token scaduto') return { kind: 'expired' };
  if (!res.ok) {
    const detail = typeof body?.error === 'string' ? `: ${body.error.slice(0, 80)}` : '';
    return { kind: 'unknown', reason: `HTTP ${res.status}${detail}` };
  }
  const token = body?.token;
  // Un server precedente a questo campo non lo manda: "sconosciuta", non
  // "nessuna scadenza", che sarebbe un'affermazione falsa.
  if (!token || typeof token !== 'object' || !('expires_at' in token)) {
    return { kind: 'unknown', reason: 'the cloud does not report it' };
  }
  const expiresAt = token.expires_at;
  if (expiresAt !== null && typeof expiresAt !== 'string') {
    return { kind: 'unknown', reason: 'unreadable expiry' };
  }
  return { kind: 'reported', expiresAt };
}

function daysLabel(days) {
  return days === 1 ? '1 day left' : `${days} days left`;
}

/**
 * @returns {{ state: 'none' | 'active' | 'warning' | 'expired' | 'unknown', text: string }}
 */
export function describeTokenExpiry(probe, now = Date.now()) {
  const renew = 'generate a new token on the web and run `jht cloud enable --token …`';
  if (probe.kind === 'expired') {
    return { state: 'expired', text: `expired: the cloud rejects this token; ${renew}` };
  }
  if (probe.kind === 'unknown') {
    return { state: 'unknown', text: `unknown (${probe.reason})` };
  }
  if (probe.expiresAt === null) return { state: 'none', text: 'no expiry' };
  const at = new Date(probe.expiresAt).getTime();
  if (Number.isNaN(at)) return { state: 'unknown', text: 'unknown (unreadable expiry)' };
  const date = probe.expiresAt.slice(0, 10);
  // Stesso confine del server: scaduto quando expires_at <= adesso.
  if (at <= now) {
    return { state: 'expired', text: `${date}, expired: ${renew}` };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  if (days <= TOKEN_EXPIRY_WARNING_DAYS) {
    return { state: 'warning', text: `${date} (${daysLabel(days)}): ${renew} before then` };
  }
  return { state: 'active', text: `${date} (${daysLabel(days)})` };
}
