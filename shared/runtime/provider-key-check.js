/**
 * provider-key-check — is the API key of a pi-only provider (glm of Z.ai, kimi of Moonshot) accepted?
 *
 * One light call, a GET of the list of models: it spends no tokens, so it costs nothing. Only an answer that says
 * the key is wrong (401) is a verdict against it; one that says the account has no credit is «no_credit» (the key is
 * kept: the person tops the account up). A 200 says nothing of the credit: Z.ai lists its models to an empty account too;
 * anything else (no network, a timeout, a 5xx, a 404 on the route,
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
 * The words of an account with no credit left (the same ones as shared/skills/provider_credit.py): Z.ai answers 429
 * with business code 1113, Kimi «suspended due to insufficient balance», OpenAI insufficient_quota. The key is right,
 * the account is empty: a different thing to tell the person than a refused key or a check that could not be made.
 */
const NO_CREDIT = /["']?code["']?\s*[:=]\s*["']?1113\b|insufficient balance|insufficient_quota|exceeded your current quota/i;
/** Read no more of an error body than this: the words are at the start, and the answer is not ours to keep. */
const BODY_LIMIT = 4096;

async function bodyStart(res) {
  try { return String(await res.text()).slice(0, BODY_LIMIT); } catch { return ''; }
}

/**
 * @param {string} providerName glm, kimi or an alias (moonshot)
 * @param {string} key the key itself
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ state: 'valid'|'rejected'|'no_credit'|'unverified'|'not_applicable', label?: string, httpStatus?: number, reason?: string }>}
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
      // the key goes to the fixed route and nowhere else: a redirect is an error, never followed
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { state: 'rejected', label, httpStatus: 401 };
    if (res.ok) return { state: 'valid', label, httpStatus: res.status };
    if (NO_CREDIT.test(await bodyStart(res))) return { state: 'no_credit', label, httpStatus: res.status };
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
