/**
 * provider-key-check — is the API key of a pi-only provider (glm of Z.ai, kimi of Moonshot) accepted?
 *
 * One light call, a GET of the list of models: it spends no tokens, so it costs nothing. Only an answer that says
 * the key is wrong (401) is a verdict against it; anything else (no network, a timeout, a 5xx, a 404 on the route,
 * a 403 that may be the region or the plan) is «could not verify», and a start must never be refused for that.
 * The key is never printed, not even in the reason.
 */
import { PI_API_PROVIDERS, piApiProvider } from './provider-models.js';

/** The route of each provider that answers with the key and nothing else (the OpenAI-compatible list of models). */
export const KEY_CHECK_URLS = Object.freeze({
  glm: 'https://api.z.ai/api/paas/v4/models',
  kimi: 'https://api.moonshot.ai/v1/models',
});

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @param {string} providerName glm, kimi or an alias (moonshot)
 * @param {string} key the key itself
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ state: 'valid'|'rejected'|'unverified'|'not_applicable', label?: string, httpStatus?: number, reason?: string }>}
 */
export async function checkPiApiKey(providerName, key, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const provider = piApiProvider(providerName);
  if (!provider || !KEY_CHECK_URLS[provider]) return { state: 'not_applicable' };
  const label = PI_API_PROVIDERS[provider].label;
  const cleanKey = typeof key === 'string' ? key.trim() : '';
  if (!cleanKey) return { state: 'unverified', label, reason: 'no key to try' };
  if (typeof fetchImpl !== 'function') return { state: 'unverified', label, reason: 'no network client' };
  try {
    const res = await fetchImpl(KEY_CHECK_URLS[provider], {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { state: 'rejected', label, httpStatus: 401 };
    if (res.ok) return { state: 'valid', label, httpStatus: res.status };
    return { state: 'unverified', label, httpStatus: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    const name = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : String(err?.cause?.code ?? err?.code ?? 'connection error');
    return { state: 'unverified', label, reason: name };
  }
}

/** The sentence for a key the provider refused: what happened and what to do, in that order. */
export function rejectedKeyMessage(label) {
  return `${label} rejected the API key (HTTP 401: wrong, expired or revoked). Put the right one in its file and run: jht setup`;
}
